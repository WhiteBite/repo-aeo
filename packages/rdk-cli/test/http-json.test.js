import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, execute, plan, probe, verify } from '../src/distribution/mechanisms/httpJson.js';

const CHANNEL = {
  id: 'registry',
  endpoint: 'https://reg.example/api/listings',
  method: 'post',
  auth: { env: 'REGISTRY_TOKEN' },
};

const PAYLOAD = { name: 'demo', url: 'https://github.com/owner/demo' };

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const res = typeof responses === 'function' ? responses(url, init, calls.length) : responses[calls.length];
    calls.push({ url, init });
    return res;
  };
  return { fetchImpl, calls };
}

const okJson = (body) => ({ ok: true, status: 200, text: async () => body });
const errHttp = (status, body = '') => ({ ok: false, status, text: async () => body });

test('describe exposes the http-json mechanism contract', () => {
  const d = describe();
  assert.equal(d.id, 'http-json');
  assert.equal(typeof d.summary, 'string');
  assert.ok(d.summary.length > 0);
});

test('plan is pure and shapes one item per target', () => {
  const ctx = { targets: ['demo', 'other'], channel: CHANNEL, payload: PAYLOAD };
  const items = plan(ctx);
  assert.deepEqual(items, [
    { target: 'demo', endpoint: 'https://reg.example/api/listings', method: 'POST', payload: PAYLOAD },
    { target: 'other', endpoint: 'https://reg.example/api/listings', method: 'POST', payload: PAYLOAD },
  ]);
  assert.deepEqual(plan(ctx), items);
});

test('plan defaults method to POST and payload to null, tolerates missing targets', () => {
  const [item] = plan({ targets: ['demo'], channel: { endpoint: 'https://reg.example/x' } });
  assert.equal(item.method, 'POST');
  assert.equal(item.payload, null);
  assert.deepEqual(plan({ targets: [], channel: CHANNEL, payload: PAYLOAD }), []);
  assert.deepEqual(plan({ channel: CHANNEL }), []);
});

test('execute posts the payload and records the listing URL from the response body', async () => {
  const [item] = plan({ targets: ['demo'], channel: CHANNEL, payload: PAYLOAD });
  const { fetchImpl, calls } = stubFetch([okJson('{"url":"https://reg.example/items/demo"}')]);
  const result = await execute({ item, channel: CHANNEL, cwd: '/tmp/rdk-demo', fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'submitted');
  assert.equal(result.record.url, 'https://reg.example/items/demo');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://reg.example/api/listings');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, JSON.stringify(PAYLOAD));
  assert.ok(result.lines.some((line) => line.includes('submitted: https://reg.example/items/demo')));
});

test('execute fails without a token and never calls fetch', async () => {
  const [item] = plan({ targets: ['demo'], channel: CHANNEL, payload: PAYLOAD });
  const { fetchImpl, calls } = stubFetch([okJson('{}')]);
  const result = await execute({ item, channel: CHANNEL, cwd: '/tmp/rdk-demo', fetchImpl, env: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /auth_required/);
  assert.equal(calls.length, 0);
});

test('execute dedupes on an existing listing with a single GET and no POST', async () => {
  const channel = { ...CHANNEL, dedupe: { url: 'https://reg.example/items/demo' } };
  const [item] = plan({ targets: ['demo'], channel, payload: PAYLOAD });
  const { fetchImpl, calls } = stubFetch([okJson('{"url":"https://reg.example/items/demo"}')]);
  const result = await execute({ item, channel, cwd: '/tmp/rdk-demo', fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'listed');
  assert.equal(result.record.url, 'https://reg.example/items/demo');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
});

test('execute falls through a dedupe 404 to the submission POST', async () => {
  const channel = { ...CHANNEL, dedupe: { url: 'https://reg.example/items/demo' } };
  const [item] = plan({ targets: ['demo'], channel, payload: PAYLOAD });
  const { fetchImpl, calls } = stubFetch([errHttp(404), okJson('{"url":"https://reg.example/items/demo"}')]);
  const result = await execute({ item, channel, cwd: '/tmp/rdk-demo', fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'submitted');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'POST');
});

test('execute fails on a non-2xx submission with the HTTP status in the error', async () => {
  const [item] = plan({ targets: ['demo'], channel: CHANNEL, payload: PAYLOAD });
  const { fetchImpl } = stubFetch([errHttp(422, 'name already taken')]);
  const result = await execute({ item, channel: CHANNEL, cwd: '/tmp/rdk-demo', fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 422/);
  assert.ok(result.error.includes('name already taken'));
});

test('execute returns a human checklist without any network when automatable is false', async () => {
  const channel = { ...CHANNEL, automatable: false };
  const [item] = plan({ targets: ['demo'], channel, payload: PAYLOAD });
  const { fetchImpl, calls } = stubFetch([okJson('{}')]);
  const result = await execute({ item, channel, cwd: '/tmp/rdk-demo', fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'prepared');
  assert.ok(Array.isArray(result.checklist.steps));
  assert.equal(calls.length, 0);
});

test('probe reports the listing URL as an http-search ref', () => {
  assert.deepEqual(probe({ url: 'https://reg.example/items/demo' }), { kind: 'http-search', ref: 'https://reg.example/items/demo' });
  assert.deepEqual(probe({}), { kind: 'http-search', ref: null });
  assert.deepEqual(probe(null), { kind: 'http-search', ref: null });
});

test('verify reads the MCP registry detail endpoint and reports presence', async () => {
  const { fetchImpl, calls } = stubFetch([okJson('{}')]);
  const result = await verify({ record: { server_name: 'io.github.owner/demo' }, fetchImpl });
  assert.deepEqual(result, { status: 'listed' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.owner%2Fdemo/versions/latest');
  assert.equal(calls[0].init.method, 'GET');
});

test('verify reports unlisted on 404 and on 5xx', async () => {
  const notFound = stubFetch([errHttp(404)]);
  assert.deepEqual(await verify({ record: { server_name: 'io.github.owner/demo' }, fetchImpl: notFound.fetchImpl }), { status: 'unlisted' });
  const serverError = stubFetch([errHttp(500)]);
  assert.deepEqual(await verify({ record: { server_name: 'io.github.owner/demo' }, fetchImpl: serverError.fetchImpl }), { status: 'unlisted' });
});

test('verify reports unlisted when the fetchImpl throws', async () => {
  const fetchImpl = async () => { throw new Error('socket hang up'); };
  assert.deepEqual(await verify({ record: { server_name: 'io.github.owner/demo' }, fetchImpl }), { status: 'unlisted' });
});

test('verify reports unlisted without server_name and never calls fetch', async () => {
  const { fetchImpl, calls } = stubFetch([okJson('{}')]);
  assert.deepEqual(await verify({ record: {}, fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(await verify({ record: { server_name: '' }, fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(await verify({ record: null, fetchImpl }), { status: 'unlisted' });
  assert.equal(calls.length, 0);
});

test('execute persists server_name in every record shape', async () => {
  const [submitItem] = plan({ targets: ['demo'], channel: CHANNEL, payload: PAYLOAD });
  const submitStub = stubFetch([okJson('{"url":"https://reg.example/items/demo"}')]);
  const submitted = await execute({ item: submitItem, channel: CHANNEL, cwd: '/tmp/rdk-demo', fetchImpl: submitStub.fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(submitted.record.server_name, PAYLOAD.name);

  const dedupeChannel = { ...CHANNEL, dedupe: { url: 'https://reg.example/items/demo' } };
  const [dedupeItem] = plan({ targets: ['demo'], channel: dedupeChannel, payload: PAYLOAD });
  const dedupeStub = stubFetch([okJson('{}')]);
  const listed = await execute({ item: dedupeItem, channel: dedupeChannel, cwd: '/tmp/rdk-demo', fetchImpl: dedupeStub.fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(listed.record.server_name, PAYLOAD.name);

  const manualChannel = { ...CHANNEL, automatable: false };
  const [manualItem] = plan({ targets: ['demo'], channel: manualChannel, payload: PAYLOAD });
  const manualStub = stubFetch([okJson('{}')]);
  const prepared = await execute({ item: manualItem, channel: manualChannel, cwd: '/tmp/rdk-demo', fetchImpl: manualStub.fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(prepared.record.server_name, PAYLOAD.name);
});

test('execute records server_name as null when the payload has no name', async () => {
  const [item] = plan({ targets: ['demo'], channel: CHANNEL, payload: { url: 'https://github.com/owner/demo' } });
  const { fetchImpl } = stubFetch([okJson('{}')]);
  const result = await execute({ item, channel: CHANNEL, cwd: '/tmp/rdk-demo', fetchImpl, env: { REGISTRY_TOKEN: 'tok' } });
  assert.equal(result.record.server_name, null);
});
