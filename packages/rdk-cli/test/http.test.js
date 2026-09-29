import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { probeUrl } from '../src/util/http.js';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function withServer(handler, run) {
  const server = await startServer(handler);
  try {
    return await run(`http://127.0.0.1:${server.address().port}/`);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

test('probeUrl retries a 503 and succeeds when the server recovers', async () => {
  let hits = 0;
  await withServer((_req, res) => {
    hits += 1;
    if (hits < 3) {
      res.writeHead(503, { 'retry-after': '0' });
      res.end('unavailable');
      return;
    }
    res.writeHead(200);
    res.end('ok');
  }, async (url) => {
    const result = await probeUrl(url, { timeoutMs: 2000, retries: 2, retryBaseMs: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.error, null);
  });
  assert.equal(hits, 3);
});

test('probeUrl honors a Retry-After header instead of the backoff delay', async () => {
  let hits = 0;
  const started = Date.now();
  await withServer((_req, res) => {
    hits += 1;
    if (hits === 1) {
      res.writeHead(429, { 'retry-after': '1' });
      res.end('slow down');
      return;
    }
    res.writeHead(200);
    res.end('ok');
  }, async (url) => {
    const result = await probeUrl(url, { timeoutMs: 2000, retries: 2, retryBaseMs: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });
  assert.equal(hits, 2);
  assert.ok(Date.now() - started >= 1000, 'the Retry-After delay must be honored');
});

test('probeUrl gives up after the retry budget and reports the 5xx status', async () => {
  let hits = 0;
  await withServer((_req, res) => {
    hits += 1;
    res.writeHead(500);
    res.end('boom');
  }, async (url) => {
    const result = await probeUrl(url, { timeoutMs: 2000, retries: 2, retryBaseMs: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
  });
  assert.equal(hits, 3, 'at most retries+1 attempts must be made');
});

test('probeUrl does not retry a plain 404', async () => {
  let hits = 0;
  await withServer((_req, res) => {
    hits += 1;
    res.writeHead(404);
    res.end('missing');
  }, async (url) => {
    const result = await probeUrl(url, { timeoutMs: 2000, retries: 2, retryBaseMs: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });
  assert.equal(hits, 1);
});
