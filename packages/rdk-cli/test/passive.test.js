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

function stubPages(pages) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = pages[url];
    if (page === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (page === null) return null;
    return { ok: page.status < 400, status: page.status, text: async () => page.body };
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

test('verify reports unlisted when the page lacks the project or answers with 404', async () => {
  const missing = stubFetch({ body: '# index\n- [other](https://github.com/other/thing)\n' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: missing.fetchImpl }), { status: 'unlisted' });

  const notFound = stubFetch({ status: 404, body: 'not found' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: notFound.fetchImpl }), { status: 'unlisted' });
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

test('verify reports unknown without fetching when the record or the checkUrl is absent', async () => {
  const stub = stubFetch({ body: `# index\n- ${RECORD.url}\n` });
  assert.deepEqual(await verifyPassive({ record: {}, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unknown' });
  assert.deepEqual(await verifyPassive({ record: null, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unknown' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: {}, fetchImpl: stub.fetchImpl }), { status: 'unknown' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: null, fetchImpl: stub.fetchImpl }), { status: 'unknown' });
  assert.deepEqual(stub.calls, []);
});

test('verify never throws raw: transport failures, non-404 error statuses and unreadable bodies resolve to unknown', async () => {
  const rejecting = async () => {
    throw new Error('boom');
  };
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: rejecting }), { status: 'unknown' });

  const unreachable = stubFetch({ status: null });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: unreachable.fetchImpl }), { status: 'unknown' });

  const serverError = stubFetch({ status: 503, body: '' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: serverError.fetchImpl }), { status: 'unknown' });

  const forbidden = stubFetch({ status: 403, body: '' });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: forbidden.fetchImpl }), { status: 'unknown' });

  const badBody = stubFetch({ textThrows: true });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: badBody.fetchImpl }), { status: 'unknown' });
});

test('verify follows a sitemap index and reports listed when a later shard carries the token', async () => {
  const stub = stubPages({
    [CHANNEL.checkUrl]: { status: 200, body: '<sitemapindex><sitemap><loc>https://example.test/shard-1.xml</loc></sitemap><sitemap><loc>https://example.test/shard-2.xml</loc></sitemap></sitemapindex>' },
    'https://example.test/shard-1.xml': { status: 200, body: '<urlset><url><loc>https://www.skills.sh/other/thing/skill</loc></url></urlset>' },
    'https://example.test/shard-2.xml': { status: 200, body: '<urlset><url><loc>https://www.skills.sh/owner/demo/my-skill</loc></url></urlset>' },
  });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'listed' });
  assert.deepEqual(stub.calls, [CHANNEL.checkUrl, 'https://example.test/shard-1.xml', 'https://example.test/shard-2.xml']);
});

test('verify reports unlisted only after reading every shard of a sitemap index', async () => {
  const stub = stubPages({
    [CHANNEL.checkUrl]: { status: 200, body: '<sitemapindex><sitemap><loc> https://example.test/shard-1.xml </loc></sitemap><sitemap><loc>https://example.test/shard-2.xml</loc></sitemap></sitemapindex>' },
    'https://example.test/shard-1.xml': { status: 200, body: '<urlset><url><loc>https://www.skills.sh/other/thing/skill</loc></url></urlset>' },
    'https://example.test/shard-2.xml': { status: 200, body: '<urlset><url><loc>https://www.skills.sh/another/one/skill</loc></url></urlset>' },
  });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unlisted' });
  assert.deepEqual(stub.calls, [CHANNEL.checkUrl, 'https://example.test/shard-1.xml', 'https://example.test/shard-2.xml']);
});

test('verify reports unknown when a shard of the sitemap index fails to fetch', async () => {
  const index = '<sitemapindex><sitemap><loc>https://example.test/shard-1.xml</loc></sitemap><sitemap><loc>https://example.test/shard-2.xml</loc></sitemap></sitemapindex>';
  const emptyShard = { status: 200, body: '<urlset/>' };

  const throwing = stubPages({ [CHANNEL.checkUrl]: { status: 200, body: index }, 'https://example.test/shard-1.xml': emptyShard });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: throwing.fetchImpl }), { status: 'unknown' });

  const nullShard = stubPages({ [CHANNEL.checkUrl]: { status: 200, body: index }, 'https://example.test/shard-1.xml': emptyShard, 'https://example.test/shard-2.xml': null });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: nullShard.fetchImpl }), { status: 'unknown' });

  const errorShard = stubPages({ [CHANNEL.checkUrl]: { status: 200, body: index }, 'https://example.test/shard-1.xml': emptyShard, 'https://example.test/shard-2.xml': { status: 503, body: '' } });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: errorShard.fetchImpl }), { status: 'unknown' });
});

test('verify reports unknown when the sitemap index lists more shards than the cap', async () => {
  const locs = Array.from({ length: 51 }, (_, i) => `<sitemap><loc>https://example.test/shard-${i}.xml</loc></sitemap>`).join('');
  const stub = stubPages({ [CHANNEL.checkUrl]: { status: 200, body: `<sitemapindex>${locs}</sitemapindex>` } });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unknown' });
  assert.deepEqual(stub.calls, [CHANNEL.checkUrl]);
});

test('verify reports unknown for a sitemap index without loc entries', async () => {
  const stub = stubPages({ [CHANNEL.checkUrl]: { status: 200, body: '<sitemapindex></sitemapindex>' } });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'unknown' });
});

test('verify tolerates a shard answering 404 and still reads the rest of the index', async () => {
  const stub = stubPages({
    [CHANNEL.checkUrl]: { status: 200, body: '<sitemapindex><sitemap><loc>https://example.test/shard-1.xml</loc></sitemap><sitemap><loc>https://example.test/shard-2.xml</loc></sitemap></sitemapindex>' },
    'https://example.test/shard-1.xml': { status: 404, body: 'not found' },
    'https://example.test/shard-2.xml': { status: 200, body: '<urlset><url><loc>https://www.skills.sh/owner/demo/my-skill</loc></url></urlset>' },
  });
  assert.deepEqual(await verifyPassive({ record: RECORD, channel: CHANNEL, fetchImpl: stub.fetchImpl }), { status: 'listed' });
  assert.deepEqual(stub.calls, [CHANNEL.checkUrl, 'https://example.test/shard-1.xml', 'https://example.test/shard-2.xml']);
});
