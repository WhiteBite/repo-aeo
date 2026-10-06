import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGhPrView, hydrateGitPr, hydrateByProbe } from '../src/distribution/tracking/hydrate.js';
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

test('hydrateByProbe keeps non-gh-pr probe kinds on their recorded state', () => {
  const entry = { target: 'foo/bar', pr_url: PR_URL };
  const cwd = process.cwd();
  const unusedGh = () => {
    throw new Error('gh must not be called for non-gh-pr probes');
  };

  const webForm = hydrateByProbe({ probe: { kind: 'web-form', ref: null }, entry, gh: unusedGh, cwd });
  assert.deepEqual(webForm, { ok: false, recorded: true, kind: 'web-form' });

  const httpJson = hydrateByProbe({ probe: { kind: 'http-json', ref: 'https://x/api' }, entry, gh: unusedGh, cwd });
  assert.deepEqual(httpJson, { ok: false, recorded: true, kind: 'http-json' });

  const gh = (args) => {
    assert.deepEqual(args, ['pr', 'view', PR_URL, '-R', 'foo/bar', '--json', GH_PR_FIELDS]);
    return { ok: true, stdout: JSON.stringify(MERGED_RAW), stderr: '', code: 0 };
  };
  const delegated = hydrateByProbe({ probe: { kind: 'gh-pr', ref: PR_URL }, entry, gh, cwd });
  assert.equal(delegated.ok, true);
  assert.deepEqual(delegated.normalized, normalizeGhPrView(MERGED_RAW));
});
