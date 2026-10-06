import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandFor,
  countChecks,
  evaluateAttention,
  isMaintainer,
  neededFor,
} from '../src/distribution/tracking/attention.js';

const NOW = '2026-10-06T00:00:00.000Z';
const CTX = { hasLive: true, now: NOW };
const ENTRY = { status: 'submitted' };

function hydrated(overrides = {}) {
  return {
    state: 'OPEN',
    review_decision: null,
    merge_state: null,
    checks: { pass: 1, fail: 0, pending: 0 },
    reviews: [],
    comments: [],
    last_push: null,
    updatedAt: null,
    ...overrides,
  };
}

test('isMaintainer accepts owner, member and collaborator associations', () => {
  assert.equal(isMaintainer('OWNER'), true);
  assert.equal(isMaintainer('MEMBER'), true);
  assert.equal(isMaintainer('COLLABORATOR'), true);
  assert.equal(isMaintainer('CONTRIBUTOR'), false);
  assert.equal(isMaintainer('NONE'), false);
  assert.equal(isMaintainer(null), false);
  assert.equal(isMaintainer(undefined), false);
});

test('countChecks parses mixed CheckRun and StatusContext rollups', () => {
  const rollup = [
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'COMPLETED', conclusion: 'FAILURE' },
    { status: 'IN_PROGRESS', conclusion: null },
    { state: 'SUCCESS' },
    { state: 'ERROR' },
    { state: 'EXPECTED' },
    { status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { state: 'PENDING' },
    { something: 'unknown' },
  ];
  assert.deepEqual(countChecks(rollup), { pass: 3, fail: 2, pending: 3 });
});

test('countChecks maps every conclusion and state bucket', () => {
  assert.deepEqual(
    countChecks([
      { status: 'COMPLETED', conclusion: 'SKIPPED' },
      { status: 'COMPLETED', conclusion: 'STALE' },
      { status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
      { status: 'COMPLETED', conclusion: 'TIMED_OUT' },
      { status: 'COMPLETED', conclusion: 'CANCELLED' },
      { status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' },
      { state: 'FAILURE' },
    ]),
    { pass: 2, fail: 5, pending: 0 },
  );
  assert.deepEqual(countChecks(null), { pass: 0, fail: 0, pending: 0 });
  assert.deepEqual(countChecks([]), { pass: 0, fail: 0, pending: 0 });
});

test('countChecks counts an unknown completed conclusion as fail', () => {
  assert.deepEqual(countChecks([{ status: 'COMPLETED', conclusion: 'NEW_CONCLUSION' }]), { pass: 0, fail: 1, pending: 0 });
  assert.deepEqual(countChecks([{ status: 'COMPLETED', conclusion: null }]), { pass: 0, fail: 1, pending: 0 });
});

test('evaluateAttention action_required: changes requested decision', () => {
  assert.equal(evaluateAttention(hydrated({ review_decision: 'CHANGES_REQUESTED' }), ENTRY, CTX), 'action_required');
});

test('evaluateAttention action_required: maintainer reviewer requested changes', () => {
  const reviews = [{ state: 'CHANGES_REQUESTED', authorAssociation: 'MEMBER' }];
  assert.equal(evaluateAttention(hydrated({ reviews }), ENTRY, CTX), 'action_required');
});

test('evaluateAttention action_required: failing checks', () => {
  assert.equal(evaluateAttention(hydrated({ checks: { pass: 0, fail: 1, pending: 0 } }), ENTRY, CTX), 'action_required');
});

test('evaluateAttention action_required: behind and dirty merge states', () => {
  assert.equal(evaluateAttention(hydrated({ merge_state: 'BEHIND' }), ENTRY, CTX), 'action_required');
  assert.equal(evaluateAttention(hydrated({ merge_state: 'DIRTY' }), ENTRY, CTX), 'action_required');
});

test('evaluateAttention action_required: maintainer comment newer than last push', () => {
  const comments = [{ createdAt: '2026-10-05T00:00:00.000Z', authorAssociation: 'COLLABORATOR' }];
  const state = hydrated({ comments, last_push: '2026-10-01T00:00:00.000Z' });
  assert.equal(evaluateAttention(state, ENTRY, CTX), 'action_required');
});

test('evaluateAttention action_required: maintainer comment when last push is unknown', () => {
  const comments = [{ createdAt: '2026-10-05T00:00:00.000Z', authorAssociation: 'COLLABORATOR' }];
  assert.equal(evaluateAttention(hydrated({ comments }), ENTRY, CTX), 'action_required');
});

test('evaluateAttention ignores a non-maintainer comment newer than last push', () => {
  const comments = [{ createdAt: '2026-10-05T00:00:00.000Z', authorAssociation: 'CONTRIBUTOR' }];
  const state = hydrated({ comments, last_push: '2026-10-01T00:00:00.000Z' });
  assert.equal(evaluateAttention(state, ENTRY, CTX), 'awaiting_review');
});

test('evaluateAttention maps live merge and close states', () => {
  assert.equal(evaluateAttention(hydrated({ state: 'MERGED' }), ENTRY, CTX), 'listed');
  assert.equal(evaluateAttention(hydrated({ state: 'CLOSED' }), ENTRY, CTX), 'terminal');
});

test('evaluateAttention approves an approved green pull request', () => {
  const state = hydrated({ review_decision: 'APPROVED', checks: { pass: 2, fail: 0, pending: 0 } });
  assert.equal(evaluateAttention(state, ENTRY, CTX), 'approved');
});

test('evaluateAttention falls back to awaiting review when only a review is required', () => {
  assert.equal(evaluateAttention(hydrated({ review_decision: 'REVIEW_REQUIRED' }), ENTRY, CTX), 'awaiting_review');
});

test('evaluateAttention marks a quiet open pull request stale past the threshold', () => {
  const state = hydrated({ updatedAt: '2026-09-20T00:00:00.000Z' });
  assert.equal(evaluateAttention(state, ENTRY, CTX), 'stale');
  assert.equal(evaluateAttention(state, ENTRY, { ...CTX, staleDays: 60 }), 'awaiting_review');
});

test('evaluateAttention without live data maps the recorded ledger status', () => {
  const offline = { hasLive: false, now: NOW };
  assert.equal(evaluateAttention(null, { status: 'listed' }, offline), 'listed');
  assert.equal(evaluateAttention(null, { status: 'closed' }, offline), 'terminal');
  assert.equal(evaluateAttention(null, { status: 'rejected' }, offline), 'terminal');
  assert.equal(evaluateAttention(null, { status: 'unlisted' }, offline), 'terminal');
  assert.equal(evaluateAttention(null, { status: 'failed' }, offline), 'terminal');
  assert.equal(evaluateAttention(null, { status: 'prepared' }, offline), 'none');
  assert.equal(evaluateAttention(null, { status: 'submitted' }, offline), 'none');
});

test('neededFor derives action codes from the hydrated pull request', () => {
  const state = hydrated({
    review_decision: 'CHANGES_REQUESTED',
    checks: { pass: 0, fail: 1, pending: 0 },
    merge_state: 'BEHIND',
  });
  assert.deepEqual(neededFor('action_required', state), ['address_review', 'fix_checks', 'rebase']);
  assert.deepEqual(neededFor('action_required', hydrated({ checks: { pass: 0, fail: 1, pending: 0 } })), ['fix_checks']);
  assert.deepEqual(neededFor('action_required', hydrated()), []);
});

test('neededFor returns the single code for the remaining states', () => {
  assert.deepEqual(neededFor('awaiting_review', hydrated()), ['await_review']);
  assert.deepEqual(neededFor('approved', hydrated()), ['merge']);
  assert.deepEqual(neededFor('listed', hydrated()), ['cleanup_fork']);
  assert.deepEqual(neededFor('stale', hydrated()), ['refresh']);
  assert.deepEqual(neededFor('none', hydrated()), []);
  assert.deepEqual(neededFor('terminal', hydrated()), []);
});

test('commandFor emits the guarded update command for action_required', () => {
  const item = {
    channel: 'awesome-list',
    target: 'owner/list',
    pr_url: 'https://github.com/owner/list/pull/9',
    attention: 'action_required',
  };
  assert.equal(
    commandFor(item, CTX),
    'rdk submit --channel awesome-list --targets owner/list --category "<CATEGORY>" --apply --ack <ACK> --reason "address review" --plan-digest <DIGEST>',
  );
});

test('commandFor emits gh pr merge for approved and guarded deletes for listed forks', () => {
  assert.equal(
    commandFor({ channel: 'awesome-list', target: 'owner/list', pr_url: 'https://github.com/owner/list/pull/9', attention: 'approved' }, CTX),
    'gh pr merge https://github.com/owner/list/pull/9 --squash',
  );
  assert.equal(
    commandFor({ channel: 'awesome-list', target: 'owner/list', pr_url: 'https://github.com/owner/list/pull/9', attention: 'listed', fork: 'me/list' }, CTX),
    'gh repo delete me/list --yes',
  );
  assert.equal(commandFor({ channel: 'awesome-list', target: 'owner/list', attention: 'listed' }, CTX), '');
  assert.equal(commandFor({ channel: 'awesome-list', target: 'owner/list', attention: 'awaiting_review' }, CTX), '');
});