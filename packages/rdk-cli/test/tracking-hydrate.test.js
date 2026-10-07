import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGhPrView, hydrateGitPr, hydrateByProbe, hydrateGitPrBatch } from '../src/distribution/tracking/hydrate.js';
import { countChecks } from '../src/distribution/tracking/attention.js';

const PR_URL = 'https://github.com/foo/bar/pull/7';
const GH_PR_FIELDS = 'state,isDraft,reviewDecision,latestReviews,reviews,comments,statusCheckRollup,mergeStateStatus,mergeable,labels,updatedAt,closedAt,mergedAt,url,commits';

const MIXED_ROLLUP = [
  { __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
  { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS' },
  { __typename: 'StatusContext', context: 'continuous-integration/travis', state: 'FAILURE' },
];

const MERGED_RAW = {
  state: 'MERGED',
  isDraft: false,
  reviewDecision: 'APPROVED',
  mergeStateStatus: 'CLEAN',
  mergedAt: '2026-10-01T10:00:00Z',
  statusCheckRollup: MIXED_ROLLUP,
  latestReviews: [{ state: 'APPROVED', authorAssociation: 'MEMBER' }],
  reviews: [{ state: 'CHANGES_REQUESTED', authorAssociation: 'FIRST_TIME_CONTRIBUTOR' }],
  comments: [{ createdAt: '2026-09-30T08:00:00Z', authorAssociation: 'CONTRIBUTOR', body: 'ship it' }],
  commits: [{ committedDate: '2026-10-04T12:00:00Z' }, { committedDate: '2026-10-05T12:00:00Z' }],
  updatedAt: '2026-10-06T00:00:00Z',
  url: PR_URL,
};

const CLOSED_RAW = {
  state: 'CLOSED',
  isDraft: false,
  reviewDecision: null,
  mergeStateStatus: 'DIRTY',
  mergedAt: null,
  statusCheckRollup: [],
  comments: [
    { createdAt: '2026-09-28T08:00:00Z', authorAssociation: 'CONTRIBUTOR', body: 'any update?' },
    { createdAt: '2026-09-29T08:00:00Z', authorAssociation: 'MEMBER', body: 'closing: out of scope' },
    { createdAt: '2026-09-30T08:00:00Z', authorAssociation: 'NONE', body: 'understood' },
  ],
  commits: [],
  updatedAt: '2026-09-30T09:00:00Z',
  url: PR_URL,
};

test('normalizeGhPrView parses merged, reviewDecision, mixed rollups and maintainer associations', () => {
  const normalized = normalizeGhPrView(MERGED_RAW);

  assert.equal(normalized.state, 'MERGED');
  assert.equal(normalized.is_draft, false);
  assert.equal(normalized.merged, true);
  assert.equal(normalized.review_decision, 'APPROVED');
  assert.equal(normalized.merge_state, 'CLEAN');
  assert.deepEqual(normalized.checks, countChecks(MIXED_ROLLUP));
  assert.deepEqual(normalized.reviews, [{ state: 'APPROVED', authorAssociation: 'MEMBER' }]);
  assert.deepEqual(normalized.comments, [{ createdAt: '2026-09-30T08:00:00Z', authorAssociation: 'CONTRIBUTOR', body: 'ship it' }]);
  assert.equal(normalized.last_push, '2026-10-05T12:00:00Z');
  assert.equal(normalized.updatedAt, '2026-10-06T00:00:00Z');
  assert.equal(normalized.close_reason, null);
  assert.equal(normalized.url, PR_URL);

  const open = normalizeGhPrView({
    state: 'OPEN',
    reviews: [{ state: 'COMMENTED', authorAssociation: 'NONE' }],
    updatedAt: '2026-10-06T00:00:00Z',
  });
  assert.equal(open.merged, false);
  assert.deepEqual(open.reviews, [{ state: 'COMMENTED', authorAssociation: 'NONE' }]);
  assert.equal(open.last_push, '2026-10-06T00:00:00Z');
  assert.equal(open.review_decision, null);
  assert.equal(open.close_reason, null);
});

test('normalizeGhPrView derives close_reason from the last maintainer comment on a closed pull request', () => {
  const normalized = normalizeGhPrView(CLOSED_RAW);

  assert.equal(normalized.state, 'CLOSED');
  assert.equal(normalized.merged, false);
  assert.equal(normalized.close_reason, 'closing: out of scope');
  assert.deepEqual(normalized.comments, [
    { createdAt: '2026-09-28T08:00:00Z', authorAssociation: 'CONTRIBUTOR', body: 'any update?' },
    { createdAt: '2026-09-29T08:00:00Z', authorAssociation: 'MEMBER', body: 'closing: out of scope' },
    { createdAt: '2026-09-30T08:00:00Z', authorAssociation: 'NONE', body: 'understood' },
  ]);
});

test('normalizeGhPrView close_reason falls back to the last comment, truncates at 500 chars and is null without comments', () => {
  const noMaintainer = normalizeGhPrView({
    ...CLOSED_RAW,
    comments: [
      { createdAt: '2026-09-28T08:00:00Z', authorAssociation: 'CONTRIBUTOR', body: 'first' },
      { createdAt: '2026-09-29T08:00:00Z', authorAssociation: 'NONE', body: 'x'.repeat(600) },
    ],
  });
  assert.equal(noMaintainer.close_reason, 'x'.repeat(500));

  assert.equal(normalizeGhPrView({ ...CLOSED_RAW, comments: [] }).close_reason, null);
});

test('hydrateGitPr calls gh pr view with the frozen field list and returns a normalized item', () => {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    return { ok: true, stdout: JSON.stringify(MERGED_RAW), stderr: '', code: 0 };
  };
  const entry = { target: 'foo/bar', pr_url: PR_URL };
  const cwd = process.cwd();

  const result = hydrateGitPr({ entry, gh, cwd });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['pr', 'view', PR_URL, '-R', 'foo/bar', '--json', GH_PR_FIELDS]);
  assert.ok(calls[0].args[6].includes('reviewDecision'));
  assert.ok(calls[0].args[6].includes('commits'));
  assert.deepEqual(calls[0].opts, { cwd });
  assert.deepEqual(result.raw, MERGED_RAW);
  assert.deepEqual(result.normalized, normalizeGhPrView(MERGED_RAW));
});

test('hydrateGitPr degrades to a recorded state when gh is missing or errors', () => {
  const entry = { target: 'foo/bar', pr_url: PR_URL };
  const cwd = process.cwd();

  const missing = hydrateGitPr({ entry, gh: () => ({ ok: false, code: 'ENOENT', stderr: '' }), cwd });
  assert.equal(missing.ok, false);
  assert.equal(typeof missing.error, 'string');
  assert.ok(missing.error.length > 0);

  const failed = hydrateGitPr({ entry, gh: () => ({ ok: false, code: 1, stdout: '', stderr: 'GraphQL: boom' }), cwd });
  assert.equal(failed.ok, false);
  assert.ok(failed.error.length > 0);

  const garbage = hydrateGitPr({ entry, gh: () => ({ ok: true, stdout: 'not json', stderr: '', code: 0 }), cwd });
  assert.equal(garbage.ok, false);
  assert.ok(garbage.error.length > 0);
});

test('hydrateByProbe dispatches crawl, http-search and registry-read to their verifiers and never calls gh', async () => {
  const NOW = '2026-10-06T00:00:00.000Z';
  const unusedGh = () => {
    throw new Error('gh must not be called for fetch probe kinds');
  };
  const fetchCalls = [];
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init });
    if (url === 'https://x/sitemap.xml') return { ok: true, status: 200, text: async () => 'see https://github.com/foo/bar and /foo/bar/ inside' };
    if (url === 'https://registry.modelcontextprotocol.io/v0.1/servers/demo-project/versions/latest') return { ok: true, status: 200, text: async () => '{}' };
    if (url === 'https://registry.npmjs.org/demo-project') return { ok: true, status: 200, text: async () => JSON.stringify({ versions: { '1.2.3': {} } }) };
    throw new Error(`unexpected fetch: ${url}`);
  };

  const crawl = await hydrateByProbe({
    entry: { channel: 'skills-sh', target: 'skills-sh', url: 'https://github.com/foo/bar', status: 'prepared' },
    channel: { id: 'skills-sh', probe: 'crawl', checkUrl: 'https://x/sitemap.xml' },
    gh: unusedGh,
    fetchImpl,
    now: () => NOW,
  });
  assert.deepEqual(crawl, {
    ok: true,
    kind: 'crawl',
    normalized: { presence: 'listed', checked_at: NOW, url: 'https://x/sitemap.xml' },
  });

  const httpSearch = await hydrateByProbe({
    entry: { channel: 'mcp-official-registry', target: 'mcp-official-registry', server_name: 'demo-project', status: 'submitted' },
    channel: { id: 'mcp-official-registry', probe: 'http-search' },
    gh: unusedGh,
    fetchImpl,
    now: () => NOW,
  });
  assert.deepEqual(httpSearch, {
    ok: true,
    kind: 'http-search',
    normalized: {
      presence: 'listed',
      checked_at: NOW,
      url: 'https://registry.modelcontextprotocol.io/v0.1/servers/demo-project/versions/latest',
    },
  });

  const registryRead = await hydrateByProbe({
    entry: { channel: 'npm-registry', target: 'npm-registry', package: 'demo-project', version: '1.2.3', registry_url: 'https://registry.npmjs.org/demo-project', status: 'prepared' },
    channel: { id: 'npm-registry', probe: 'registry-read' },
    gh: unusedGh,
    fetchImpl,
    now: () => NOW,
  });
  assert.deepEqual(registryRead, {
    ok: true,
    kind: 'registry-read',
    normalized: { presence: 'listed', checked_at: NOW, url: 'https://registry.npmjs.org/demo-project' },
  });

  assert.equal(fetchCalls.length, 3);
});

test('hydrateByProbe wraps an unlisted verifier result as ok with presence unlisted', async () => {
  const NOW = '2026-10-06T00:00:00.000Z';
  const unusedGh = () => {
    throw new Error('gh must not be called for fetch probe kinds');
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'nothing relevant here' });

  const crawl = await hydrateByProbe({
    entry: { channel: 'skills-sh', target: 'skills-sh', url: 'https://github.com/foo/bar', status: 'prepared' },
    channel: { id: 'skills-sh', probe: 'crawl', checkUrl: 'https://x/sitemap.xml' },
    gh: unusedGh,
    fetchImpl,
    now: () => NOW,
  });
  assert.equal(crawl.ok, true);
  assert.equal(crawl.kind, 'crawl');
  assert.equal(crawl.normalized.presence, 'unlisted');
  assert.equal(crawl.normalized.url, 'https://x/sitemap.xml');
  assert.equal(crawl.normalized.checked_at, NOW);
});

test('hydrateByProbe degrades a non-definitive verifier outcome to the recorded state', async () => {
  const unusedGh = () => {
    throw new Error('gh must not be called for fetch probe kinds');
  };
  const rejectingFetch = async () => {
    throw new Error('network unreachable');
  };

  const legacyHttpSearch = await hydrateByProbe({
    entry: { channel: 'mcp-official-registry', target: 'mcp.so', status: 'submitted' },
    channel: { id: 'mcp-official-registry', probe: 'http-search' },
    gh: unusedGh,
    fetchImpl: rejectingFetch,
  });
  assert.deepEqual(legacyHttpSearch, { ok: false, kind: 'http-search', recorded: true });

  const legacyCrawl = await hydrateByProbe({
    entry: { channel: 'skills-sh', target: 'skills-sh', status: 'prepared' },
    channel: { id: 'skills-sh', probe: 'crawl', checkUrl: 'https://x/sitemap.xml' },
    gh: unusedGh,
    fetchImpl: rejectingFetch,
  });
  assert.deepEqual(legacyCrawl, { ok: false, kind: 'crawl', recorded: true });

  const legacyRegistry = await hydrateByProbe({
    entry: { channel: 'npm-registry', target: 'npm-registry', status: 'prepared' },
    channel: { id: 'npm-registry', probe: 'registry-read' },
    gh: unusedGh,
    fetchImpl: rejectingFetch,
  });
  assert.deepEqual(legacyRegistry, { ok: false, kind: 'registry-read', recorded: true });

  const serverError = await hydrateByProbe({
    entry: { channel: 'skills-sh', target: 'skills-sh', url: 'https://github.com/foo/bar', status: 'prepared' },
    channel: { id: 'skills-sh', probe: 'crawl', checkUrl: 'https://x/sitemap.xml' },
    gh: unusedGh,
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  });
  assert.deepEqual(serverError, { ok: false, kind: 'crawl', recorded: true });
});

test('hydrateByProbe keeps none and unknown probe kinds on their recorded state', async () => {
  const unusedGh = () => {
    throw new Error('gh must not be called for recorded probe kinds');
  };
  const unusedFetch = async () => {
    throw new Error('fetch must not be called for recorded probe kinds');
  };

  const none = await hydrateByProbe({
    entry: { channel: 'mcp-directory-form', target: 'mcp.so', status: 'prepared' },
    channel: { id: 'mcp-directory-form', probe: 'none' },
    gh: unusedGh,
    fetchImpl: unusedFetch,
  });
  assert.deepEqual(none, { ok: false, kind: 'none', recorded: true });

  const unknown = await hydrateByProbe({
    entry: { channel: 'carrier-pigeon', target: 'somewhere', status: 'prepared' },
    channel: { id: 'carrier-pigeon', probe: 'smoke-signal' },
    gh: unusedGh,
    fetchImpl: unusedFetch,
  });
  assert.deepEqual(unknown, { ok: false, kind: 'smoke-signal', recorded: true });

  const noChannelNoPr = await hydrateByProbe({ entry: { target: 'a/b', status: 'prepared' }, channel: null, gh: unusedGh, fetchImpl: unusedFetch });
  assert.deepEqual(noChannelNoPr, { ok: false, kind: null, recorded: true });
});

test('hydrateByProbe delegates gh-pr to hydrateGitPr with the unchanged normalized PR shape', async () => {
  const entry = { target: 'foo/bar', pr_url: PR_URL };
  const cwd = process.cwd();
  const gh = (args) => {
    assert.deepEqual(args, ['pr', 'view', PR_URL, '-R', 'foo/bar', '--json', GH_PR_FIELDS]);
    return { ok: true, stdout: JSON.stringify(MERGED_RAW), stderr: '', code: 0 };
  };

  const delegated = await hydrateByProbe({ entry, channel: null, gh, cwd });
  assert.equal(delegated.ok, true);
  assert.equal(delegated.kind, 'gh-pr');
  assert.deepEqual(delegated.normalized, normalizeGhPrView(MERGED_RAW));
  assert.deepEqual(delegated.raw, MERGED_RAW);

  const viaDescriptor = await hydrateByProbe({ entry, channel: { id: 'awesome-list', probe: 'gh-pr' }, gh, cwd });
  assert.equal(viaDescriptor.ok, true);
  assert.equal(viaDescriptor.kind, 'gh-pr');
  assert.deepEqual(viaDescriptor.normalized, normalizeGhPrView(MERGED_RAW));

  const noRef = await hydrateByProbe({ entry: { target: 'foo/bar' }, channel: { id: 'awesome-list', probe: 'gh-pr' }, gh, cwd });
  assert.deepEqual(noRef, { ok: false, kind: 'gh-pr', recorded: true });
});

test('hydrateByProbe never throws when a gh probe fails', async () => {
  const entry = { target: 'foo/bar', pr_url: PR_URL };
  const cwd = process.cwd();

  const failed = await hydrateByProbe({ entry, channel: null, gh: () => ({ ok: false, code: 1, stdout: '', stderr: 'boom' }), cwd });
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, 'gh-pr');
  assert.ok(failed.error.length > 0);

  const garbage = await hydrateByProbe({ entry, channel: null, gh: () => ({ ok: true, stdout: 'not json', stderr: '', code: 0 }), cwd });
  assert.equal(garbage.ok, false);
  assert.equal(garbage.kind, 'gh-pr');
  assert.ok(garbage.error.length > 0);
});

const PR_URL_A = 'https://github.com/foo/bar/pull/7';
const PR_URL_B = 'https://github.com/foo/bar/pull/8';

function graphNode(overrides = {}) {
  return {
    state: 'OPEN',
    isDraft: false,
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    mergedAt: null,
    updatedAt: '2026-10-06T00:00:00Z',
    url: PR_URL_A,
    latestReviews: { nodes: [{ author: { login: 'alice' }, authorAssociation: 'MEMBER', state: 'APPROVED', submittedAt: '2026-10-05T10:00:00Z' }] },
    reviews: { nodes: [{ author: { login: 'dave' }, authorAssociation: 'FIRST_TIME_CONTRIBUTOR', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-04T10:00:00Z' }] },
    comments: { nodes: [{ author: { login: 'bob' }, authorAssociation: 'MEMBER', body: 'please address the review comments', createdAt: '2026-10-05T11:00:00Z' }] },
    statusCheckRollup: {
      contexts: {
        nodes: [
          { __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'StatusContext', context: 'continuous-integration/travis', state: 'FAILURE' },
        ],
      },
    },
    commits: { nodes: [{ commit: { committedDate: '2026-10-05T12:00:00Z' } }] },
    ...overrides,
  };
}

test('hydrateGitPrBatch issues exactly one graphql call and maps aliases through normalizeGhPrView', () => {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    return { ok: true, stdout: JSON.stringify({ data: { pr0: { pullRequest: graphNode() }, pr1: null } }), stderr: '', code: 0 };
  };
  const entries = [
    { target: 'foo/bar', pr_url: PR_URL_A },
    { target: 'foo/bar', pr_url: PR_URL_B },
  ];

  const results = hydrateGitPrBatch({ entries, gh, cwd: process.cwd() });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['api', 'graphql', '--input', '-']);
  const payload = JSON.parse(calls[0].opts.input);
  assert.match(payload.query, /query\(\$o0: String! \$n0: String! \$p0: Int!/);
  assert.match(payload.query, /pr0: repository\(owner:\$o0, name:\$n0\)\{ pullRequest\(number:\$p0\)\{/);
  assert.match(payload.query, /pr1: repository\(owner:\$o1, name:\$n1\)\{ pullRequest\(number:\$p1\)\{/);
  assert.ok(payload.query.includes('statusCheckRollup{contexts(first:100)'));
  assert.ok(payload.query.includes('commits(last:1){nodes{commit{committedDate}}}'));
  assert.deepEqual(payload.variables, { o0: 'foo', n0: 'bar', p0: 7, o1: 'foo', n1: 'bar', p1: 8 });

  assert.equal(results.size, 2);
  const first = results.get(PR_URL_A);
  assert.equal(first.ok, true);
  assert.equal(first.kind, 'gh-pr');
  assert.equal(first.normalized.state, 'OPEN');
  assert.equal(first.normalized.is_draft, false);
  assert.deepEqual(first.normalized.checks, { pass: 1, fail: 1, pending: 0 });
  assert.equal(first.normalized.reviews[0].state, 'APPROVED');
  assert.equal(first.normalized.last_push, '2026-10-05T12:00:00Z');
  assert.deepEqual(results.get(PR_URL_B), { ok: false, kind: 'gh-pr', recorded: true });
});

test('hydrateGitPrBatch requests the per-item field set and maps it identically', () => {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    return { ok: true, stdout: JSON.stringify({ data: { pr0: { pullRequest: graphNode() } } }), stderr: '', code: 0 };
  };

  const results = hydrateGitPrBatch({ entries: [{ target: 'foo/bar', pr_url: PR_URL_A }], gh, cwd: process.cwd() });

  const query = JSON.parse(calls[0].opts.input).query;
  assert.ok(query.includes('authorAssociation'), 'the batch query must request review and comment author associations');
  assert.ok(query.includes('body'), 'the batch query must request comment bodies');
  assert.ok(query.includes('updatedAt'), 'the batch query must request the PR updatedAt timestamp');

  const node = graphNode();
  const perItemRaw = {
    state: node.state,
    isDraft: node.isDraft,
    reviewDecision: node.reviewDecision,
    mergeStateStatus: node.mergeStateStatus,
    mergedAt: node.mergedAt,
    updatedAt: node.updatedAt,
    url: node.url,
    latestReviews: node.latestReviews.nodes,
    reviews: node.reviews.nodes,
    comments: node.comments.nodes,
    statusCheckRollup: node.statusCheckRollup.contexts.nodes,
    commits: node.commits.nodes.map((entry) => entry.commit),
  };
  assert.deepEqual(results.get(PR_URL_A).normalized, normalizeGhPrView(perItemRaw));
});

test('hydrateGitPrBatch degrades every entry to recorded when the graphql call fails', () => {
  const entries = [
    { target: 'foo/bar', pr_url: PR_URL_A },
    { target: 'foo/bar', pr_url: PR_URL_B },
  ];
  const cwd = process.cwd();

  const failed = hydrateGitPrBatch({ entries, gh: () => ({ ok: false, stdout: '', stderr: 'GraphQL: boom', code: 1 }), cwd });
  assert.deepEqual(failed.get(PR_URL_A), { ok: false, kind: 'gh-pr', recorded: true });
  assert.deepEqual(failed.get(PR_URL_B), { ok: false, kind: 'gh-pr', recorded: true });

  const garbage = hydrateGitPrBatch({ entries, gh: () => ({ ok: true, stdout: 'not json', stderr: '', code: 0 }), cwd });
  assert.deepEqual(garbage.get(PR_URL_A), { ok: false, kind: 'gh-pr', recorded: true });
  assert.deepEqual(garbage.get(PR_URL_B), { ok: false, kind: 'gh-pr', recorded: true });

  const thrown = hydrateGitPrBatch({ entries, gh: () => { throw new Error('gh exploded'); }, cwd });
  assert.deepEqual(thrown.get(PR_URL_A), { ok: false, kind: 'gh-pr', recorded: true });
  assert.deepEqual(thrown.get(PR_URL_B), { ok: false, kind: 'gh-pr', recorded: true });
});

test('hydrateGitPrBatch skips malformed pr urls and keeps them recorded', () => {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    return { ok: true, stdout: JSON.stringify({ data: { pr0: { pullRequest: graphNode() } } }), stderr: '', code: 0 };
  };
  const entries = [
    { target: 'foo/bar', pr_url: 'https://gitlab.com/foo/bar/pull/7' },
    { target: 'foo/bar', pr_url: 'https://github.com/foo/bar/issues/7' },
    { target: 'foo/bar' },
    { target: 'foo/bar', pr_url: PR_URL_A },
  ];

  const results = hydrateGitPrBatch({ entries, gh, cwd: process.cwd() });

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].opts.input);
  assert.match(payload.query, /pr0: repository\(owner:\$o0, name:\$n0\)\{ pullRequest\(number:\$p0\)\{/);
  assert.doesNotMatch(payload.query, /pr1/);
  assert.deepEqual(payload.variables, { o0: 'foo', n0: 'bar', p0: 7 });

  assert.deepEqual(results.get('https://gitlab.com/foo/bar/pull/7'), { ok: false, kind: 'gh-pr', recorded: true });
  assert.deepEqual(results.get('https://github.com/foo/bar/issues/7'), { ok: false, kind: 'gh-pr', recorded: true });
  assert.deepEqual(results.get(undefined), { ok: false, kind: 'gh-pr', recorded: true });
  assert.equal(results.get(PR_URL_A).ok, true);
  assert.equal(results.get(PR_URL_A).normalized.state, 'OPEN');
});
