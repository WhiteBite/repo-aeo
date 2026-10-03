import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { handleMessage, serve, PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from '../src/server.js';

test('serve routes a server-initiated elicitation request and waits for the client answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-elic-'));
  const input = new PassThrough();
  const chunks = [];
  const output = {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
  };
  const served = serve({ input, output, cwd: dir });
  const messages = () => chunks
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i += 1) {
      const found = messages().find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('timed out waiting for a server message');
  };
  try {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 't', version: '0' } } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'github_sync_metadata', arguments: { ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'transport elicitation', apply: true } } })}\n`);
    const request = await waitFor((message) => message.method === 'elicitation/create');
    assert.match(String(request.id), /^server-/);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { action: 'decline' } })}\n`);
    const final = await waitFor((message) => message.id === 2);
    const payload = JSON.parse(final.result.content[0].text);
    assert.equal(payload.code, 'elicitation_declined');
  } finally {
    input.end();
    await served;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('initialize answers with the protocol version and server info', async () => {
  const response = await handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, '2024-11-05', 'a supported client version is echoed back');
  const modern = await handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  assert.equal(modern.result.protocolVersion, PROTOCOL_VERSION, 'an unknown client version falls back to the server latest');
  assert.equal(response.result.serverInfo.name, SERVER_NAME);
  assert.equal(response.result.serverInfo.version, SERVER_VERSION);
  assert.ok(response.result.instructions.length > 20, 'the server must tell agents how to behave');
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false }, elicitation: {} });
});

test('notifications never produce a response', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'initialized' }), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'some/future-notification' }), null);
  // A missing id counts as a notification.
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'ping' }), null);
});

test('ping and tools/list answer the standard shapes', async () => {
  const ping = await handleMessage({ jsonrpc: '2.0', id: 'p', method: 'ping' });
  assert.deepEqual(ping.result, {});

  const list = await handleMessage({ jsonrpc: '2.0', id: 'l', method: 'tools/list' });
  assert.equal(list.result.tools.length, 9);
  for (const tool of list.result.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.annotations, `${tool.name} must carry annotations`);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
  }
});

test('resources and prompts lists are empty instead of unknown', async () => {
  for (const method of ['resources/list', 'prompts/list', 'resources/templates/list']) {
    const response = await handleMessage({ jsonrpc: '2.0', id: method, method });
    assert.ok(response.result, `${method} must return a result`);
    assert.equal(response.error, undefined, `${method} must not error`);
  }
});

test('tools/call returns content and flags failures with isError', async () => {
  const ok = await handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'competitor_scan_list_articles', arguments: { query: 'discoverability' } },
  });
  assert.equal(ok.result.isError, true, 'a tool-level failure must set isError');
  const payload = JSON.parse(ok.result.content[0].text);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /RDK_SEARCH_ENDPOINT/);

  // An unknown tool is a tool-level failure, not a protocol error.
  const unknown = await handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'not_a_tool', arguments: {} },
  });
  assert.equal(unknown.result.isError, true);
  assert.match(JSON.parse(unknown.result.content[0].text).error, /unknown tool/);

  const noName = await handleMessage({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: {} });
  assert.equal(noName.error.code, -32602);
});

test('tools/call reports a guarded write without applying it', async () => {
  const response = await handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'github_sync_metadata',
      arguments: { cwd: '/tmp', ack: 'WRONG', reason: 'unit test' },
    },
  });
  assert.equal(response.result.isError, true);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /refusing to write/);
});

test('read-only mode hides the write tool from tools/list and refuses calls to it', async () => {
  const context = { readOnly: true };

  const list = await handleMessage({ jsonrpc: '2.0', id: 'ro-list', method: 'tools/list' }, context);
  const names = list.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 8, 'the write tool must be omitted from tools/list');
  assert.ok(!names.includes('github_sync_metadata'));

  const call = await handleMessage(
    {
      jsonrpc: '2.0',
      id: 'ro-call',
      method: 'tools/call',
      params: { name: 'github_sync_metadata', arguments: { ack: 'WRONG', reason: 'unit test' } },
    },
    context,
  );
  assert.equal(call.result.isError, true);
  const payload = JSON.parse(call.result.content[0].text);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /unknown tool: github_sync_metadata/);
});

test('malformed requests get JSON-RPC error codes', async () => {
  const notObject = await handleMessage('nope');
  assert.equal(notObject.error.code, -32600);

  const array = await handleMessage([1, 2, 3]);
  assert.equal(array.error.code, -32600);

  const unknownMethod = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'nope' });
  assert.equal(unknownMethod.error.code, -32601);
  assert.equal(unknownMethod.id, 9);

  const missingName = await handleMessage({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: {} });
  assert.equal(missingName.error.code, -32602);
});

test('the stdio loop answers a full handshake and survives junk input', async () => {
  const chunks = [];
  const input = new PassThrough();
  const output = {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
  };
  const lines = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    'this is not json',
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'llms_txt_check_freshness', arguments: { cwd: '/tmp' } } }),
  ];
  // Drive the real readline loop over a PassThrough stream.
  const served = serve({ input, output });
  await new Promise((resolve) => setImmediate(resolve));
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await served;

  const messages = chunks
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

  // 3 responses (initialize, ping, tools/call) plus one parse error.
  assert.equal(messages.length, 4, `expected 4 responses, got ${messages.length}`);
  assert.equal(messages[0].result.serverInfo.name, SERVER_NAME);
  assert.equal(messages[1].error.code, -32700);
  assert.deepEqual(messages[2].result, {});
  assert.equal(messages[3].result.content[0].type, 'text');
  const freshness = JSON.parse(messages[3].result.content[0].text);
  assert.equal(freshness.ok, false, '/tmp has no llms.txt');
  assert.match(freshness.error, /llms\.txt not found/);
});
