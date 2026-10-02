/**
 * Minimal, dependency-free MCP stdio server.
 *
 * Implements the subset of the Model Context Protocol that a tool server needs:
 * newline-delimited JSON-RPC 2.0 over stdio with `initialize`,
 * `notifications/initialized`, `ping`, `tools/list` and `tools/call`.
 * Keeping it dependency-free matches the RDK product property (fast npx, tiny
 * supply chain); the official SDK can replace this transport later without
 * touching the tool implementations in tools.js.
 */
import { callTool, toolDescriptors } from './tools.js';

export const SERVER_NAME = 'repo-aeo-mcp';
export const SERVER_VERSION = '0.1.0';
export const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function textContent(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return [{ type: 'text', text }];
}

/**
 * Handles one decoded JSON-RPC message.
 * Returns the response object, or null for notifications (no reply expected).
 */
export async function handleMessage(message, context = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, 'expected a JSON-RPC object');
  }
  const { method, params, id } = message;
  const isNotification = id === undefined || id === null;

  // JSON-RPC 2.0: a message without an id is a notification and must never be
  // answered, whatever the method is.
  if (isNotification) return null;

  switch (method) {
    case 'initialize':
      if (context && params && params.capabilities) context.clientCapabilities = params.capabilities;
      return jsonRpcResult(id, {
        protocolVersion: params && SUPPORTED_PROTOCOL_VERSIONS.has(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, elicitation: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION, title: 'Repo Discoverability Kit MCP server' },
        instructions:
          'Read-only by default. github_sync_metadata is the only write tool and requires an acknowledgement string plus a reason. Use repo_get_discoverability_score and repo_list_findings to work through improvements.',
      });

    case 'notifications/initialized':
    case 'initialized':
      return null;

    case 'ping':
      return jsonRpcResult(id, {});

    // Tool-only server: advertise empty resource and prompt lists so clients
    // that probe for them get a valid answer instead of method-not-found.
    case 'resources/list':
    case 'prompts/list':
      return jsonRpcResult(id, { [method.split('/')[0]]: [] });

    case 'resources/templates/list':
      return jsonRpcResult(id, { resourceTemplates: [] });

    case 'tools/list':
      return jsonRpcResult(id, { tools: toolDescriptors(context) });

    case 'tools/call': {
      const name = params && typeof params.name === 'string' ? params.name : null;
      const args = (params && params.arguments) || {};
      if (!name) {
        return jsonRpcError(id, JSON_RPC_ERRORS.invalidParams, 'tools/call requires params.name');
      }
      const result = await callTool(name, args, context);
      return jsonRpcResult(id, {
        content: textContent(result),
        isError: result && result.ok === false,
      });
    }

    default:
      return jsonRpcError(id, JSON_RPC_ERRORS.methodNotFound, `method not found: ${String(method)}`);
  }
}

/** Starts the stdio loop. Returns a promise that resolves when stdin closes. */
export async function serve({
  cwd = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  readOnly = false,
} = {}) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input, crlfDelay: Infinity });
  const context = { cwd, readOnly: readOnly === true };
  const pending = new Map();
  let serverRequestId = 0;
  context.request = (method, params, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      serverRequestId += 1;
      const requestId = `server-${serverRequestId}`;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`client did not answer ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    });

  // settled entries are dropped so a long-lived serve does not accumulate them for the process lifetime
  const inFlight = [];
  const track = (promise) => {
    inFlight.push(promise);
    promise.finally(() => {
      const index = inFlight.indexOf(promise);
      if (index >= 0) inFlight.splice(index, 1);
    });
    return promise;
  };
  // the loop must stay free to read client answers while a handler awaits elicitation
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      output.write(`${JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.parse, `invalid JSON: ${error.message}`))}\n`);
      continue;
    }
    if (message && typeof message === 'object' && message.id !== undefined && (message.result !== undefined || message.error !== undefined) && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message || 'client returned an error'));
      else waiter.resolve(message.result);
      continue;
    }
    track(
      Promise.resolve()
        .then(async () => {
          const response = await handleMessage(message, context);
          if (response !== null) output.write(`${JSON.stringify(response)}\n`);
        })
        .catch((error) => {
          const failedId = message && message.id !== undefined && message.id !== null ? message.id : null;
          output.write(`${JSON.stringify(jsonRpcError(failedId, JSON_RPC_ERRORS.internal, String((error && error.message) || error)))}\n`);
        }),
    );
  }
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('connection closed before the client answered'));
  }
  await Promise.allSettled(inFlight);
}

export default { serve, handleMessage, SERVER_NAME, SERVER_VERSION, PROTOCOL_VERSION };
