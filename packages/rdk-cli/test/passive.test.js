import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { planDigest } from '../src/distribution/guard.js';
import {
  describe as describePassive,
  plan as planPassive,
  execute as executePassive,
  probe as probePassive,
  verify as verifyPassive,
} from '../src/distribution/mechanisms/passive.js';
import { makeRepo, removeRepo } from './helpers.js';

const CHANNEL = { id: 'skills-sh', mechanism: 'passive', checkUrl: 'https://example.test/index' };
const RECORD = { channel: 'skills-sh', url: 'https://github.com/owner/demo', status: 'submitted' };

function stubFetch({ status = 200, body = '', textThrows = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (status === null) throw new Error('network unreachable');
    return {
      ok: status < 400,
      status,
      text: async () => {
        if (textThrows) throw new Error('body read failed');
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

test('describe exposes the passive mechanism contract', () => {
  assert.equal(describePassive().id, 'passive');
  assert.equal(typeof describePassive().summary, 'string');
  assert.ok(describePassive().summary.length > 0);
});

test('plan is pure and shapes the precondition checklist as the digest input', () => {
  const items = planPassive({ channel: CHANNEL });
  assert.deepEqual(items, [
    { channel: 'skills-sh', precondition: 'public-repo', requirement: 'the repository is public so crawlers can reach it' },
    { channel: 'skills-sh', precondition: 'llms-txt', requirement: 'llms.txt is served at the repository root' },
    { channel: 'skills-sh', precondition: 'topics-set', requirement: 'GitHub topics are set so topic crawls surface the project' },
  ]);
  assert.equal(planDigest(items), planDigest(planPassive({ channel: CHANNEL })));
  assert.notEqual(planDigest(planPassive({ channel: { ...CHANNEL, id: 'github-topics' } })), planDigest(items));
  assert.ok(planPassive({}).every((item) => item.channel === 'passive'));
  assert.deepEqual(planPassive(), planPassive({}));
});

test('execute performs no write and returns the crawlability preconditions', () => {
  const dir = makeRepo({ 'README.md': '# demo\n' });
  try {
    const before = readdirSync(dir);
    const items = planPassive({ channel: CHANNEL });
    const result = executePassive({ item: items[0], channel: CHANNEL, cwd: dir, config: {} });
    assert.equal(result.ok, true);
    assert.ok(result.lines.every((line) => typeof line === 'string'));
    assert.equal(result.lines[0], '## skills-sh');
    assert.ok(result.lines.includes('precondition: the repository is public so crawlers can reach it'));
    assert.ok(result.lines.some((line) => line.includes(CHANNEL.checkUrl)));
    assert.deepEqual(result.checklist.steps, items.map((item) => item.requirement));
    assert.deepEqual(readdirSync(dir), before);
  } finally {
    removeRepo(dir);
  }
});

test('probe exposes the crawl contract', () => {
  assert.deepEqual(probePassive(RECORD), { kind: 'crawl', ref: 'https://github.com/owner/demo' });
  assert.deepEqual(probePassive({}), { kind: 'crawl', ref: null });
  assert.deepEqual(probePassive({ url: '' }), { kind: 'crawl', ref: null });
  assert.deepEqual(probePassive(null), { kind: 'crawl', ref: null });
});

test('verify reports listed when the channel page contains the project URL', async () => {
  const stub = stubFetch({ body: '# index\n- [demo](https://github.com/owner/demo) — a demo\n' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'listed' });
  assert.deepEqual(stub.calls, [CHANNEL.checkUrl]);
});

test('verify reports unlisted when the page lacks the project or answers with an error', async () => {
  const missing = stubFetch({ body: '# index\n- [other](https://github.com/other/thing)\n' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: missing.fetchImpl }), { status: 'unlisted' });

  const notFound = stubFetch({ status: 404, body: 'not found' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: notFound.fetchImpl }), { status: 'unlisted' });

  const unreachable = stubFetch({ status: null });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: unreachable.fetchImpl }), { status: 'unlisted' });
});

test('verify matches the repo path token on a sitemap and the full url when present', async () => {
  const sitemap = stubFetch({ body: '<url><loc>https://www.skills.sh/owner/demo/my-skill</loc></url>\n' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: sitemap.fetchImpl }), { status: 'listed' });

  const fullUrl = stubFetch({ body: `see ${RECORD.url} for details` });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: fullUrl.fetchImpl }), { status: 'listed' });

  const absent = stubFetch({ body: '<url><loc>https://www.skills.sh/other/thing/my-skill</loc></url>\n' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: absent.fetchImpl }), { status: 'unlisted' });

  const nonGithub = { channel: 'skills-sh', url: 'https://example.com/owner/demo', status: 'submitted' };
  const tokenOnly = stubFetch({ body: '<url><loc>https://www.skills.sh/owner/demo/my-skill</loc></url>\n' });
  assert.deepEqual(await verifyPassive({ record: nonGithub, channel: CHANNEL, fetchImpl: tokenOnly.fetchImpl }), { status: 'unlisted' });
});

test('execute emits a record carrying the project url for the public-repo precondition', () => {
  const dir = makeRepo({ 'README.md': '# demo\n' });
  try {
    const items = planPassive({ channel: CHANNEL });
    const result = executePassive({ item: items[0], channel: CHANNEL, cwd: dir, config: {}, url: 'https://github.com/owner/demo' });
    assert.equal(result.ok, true);
    assert.equal(result.record.channel, 'skills-sh');
    assert.equal(result.record.url, 'https://github.com/owner/demo');
    assert.equal(result.record.target, 'skills-sh');
    assert.equal(result.record.status, 'prepared');
    assert.match(result.record.submitted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(result.checklist.steps, items.map((item) => item.requirement));

    const withoutUrl = executePassive({ item: items[0], channel: CHANNEL, cwd: dir, config: {} });
    assert.equal(withoutUrl.record.url, null);

    const other = executePassive({ item: items[1], channel: CHANNEL, cwd: dir, config: {}, url: 'https://github.com/owner/demo' });
    assert.equal(other.record, undefined);
  } finally {
    removeRepo(dir);
  }
});

test('verify reports unlisted without fetching when the record or the checkUrl is absent', async () => {
  const stub = stubFetch({ body: `# index\n- ${RECORD.url}\n` });
  assert.deepEqual(await verifyPassive({ record: {}, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(await verifyPassive({ record: null, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: {}, fetchImpl: stub.fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: null, fetchImpl: stub.fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(stub.calls, []);
});

test('verify never throws raw: a rejecting fetch or an unreadable body resolves to unlisted', async () => {
  const rejecting = async () => {
    throw new Error('boom');
  };
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: rejecting }), { status: 'unlisted' });
  const badBody = stubFetch({ textThrows: true });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: badBody.fetchImpl }), { status: 'unlisted' });
});
