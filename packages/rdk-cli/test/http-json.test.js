import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, execute, plan, probe } from '../src/distribution/mechanisms/httpJson.js';

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
