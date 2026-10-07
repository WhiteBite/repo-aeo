import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, removeRepo } from './helpers.js';
import {
  DISTRIBUTION_SCHEMA,
  buildDistributionStatus,
  renderDistributionStatus,
} from '../src/distribution/tracking/status.js';
import { readTrackingCache, snapshotKey, trackingCachePath } from '../src/distribution/tracking/cache.js';

const NOW = '2026-10-06T00:00:00.000Z';
const PR1 = 'https://github.com/owner/list/pull/1';
const PR2 = 'https://github.com/owner/list/pull/2';
const PR3 = 'https://github.com/owner/list/pull/3';
const PR4 = 'https://github.com/owner/list/pull/4';
const PR5 = 'https://github.com/owner/list/pull/5';
const PR6 = 'https://github.com/owner/list/pull/6';

function raw(overrides = {}) {
  return {
    state: 'OPEN',
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: 'CLEAN',
    mergedAt: null,
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    latestReviews: [],
    reviews: [],
    comments: [],
    commits: [{ committedDate: '2026-10-05T12:00:00Z' }],
    updatedAt: '2026-10-05T12:00:00Z',
    url: null,
    ...overrides,
  };
}

function ghStub(byUrl) {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    const found = byUrl[args[2]];
    if (!found) return { ok: false, stderr: 'not found', code: 1 };
    return { ok: true, stdout: JSON.stringify(found), stderr: '', code: 0 };
  };
  return { gh, calls };
}

function ledgerRepo(rows) {
  return makeRepo({
    '.discoverability/submissions.json': `${JSON.stringify(rows, null, 2)}\n`,
  });
}

test('buildDistributionStatus emits the schema, injected generated_at, a zero-filled summary and items', async () => {
  const cwd = ledgerRepo([{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted' }]);
  try {
    const { gh } = ghStub({ [PR1]: raw({ url: PR1 }) });

    const status = await buildDistributionStatus({ cwd, loaded: {}, gh, live: true, now: () => NOW });

    assert.equal(status.schema_version, DISTRIBUTION_SCHEMA);
    assert.equal(status.generated_at, NOW);
    assert.equal(status.summary.total, 1);
    assert.deepEqual(Object.keys(status.summary.by_attention).sort(), [
      'action_required',
      'approved',
      'awaiting_review',
      'listed',
      'none',
      'stale',
      'terminal',
    ]);
    assert.deepEqual(Object.keys(status.summary.by_state).sort(), ['closed', 'merged', 'open', 'unknown']);
    assert.equal(status.items.length, 1);
    assert.equal(status.items[0].channel, 'awesome-list');
    assert.equal(status.items[0].target, 'owner/list');
    assert.equal(status.items[0].pr_url, PR1);
    assert.equal(status.items[0].state, 'OPEN');
    assert.equal(status.items[0].is_draft, false);
    assert.deepEqual(status.items[0].checks, { pass: 1, fail: 0, pending: 0 });
  } finally {
    removeRepo(cwd);
  }
});

test('buildDistributionStatus marks an open changes-requested row action_required with a guarded command', async () => {
  const cwd = ledgerRepo([{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted' }]);
  try {
    const { gh } = ghStub({
      [PR1]: raw({ reviewDecision: 'CHANGES_REQUESTED', latestReviews: [{ state: 'CHANGES_REQUESTED', authorAssociation: 'MEMBER' }], url: PR1 }),
    });

    const status = await buildDistributionStatus({ cwd, loaded: {}, gh, live: true, now: () => NOW });
    const item = status.items[0];

    assert.equal(item.attention, 'action_required');
    assert.ok(item.needed.includes('address_review'));
    assert.equal(item.action, 'address_review');
    assert.equal(item.why, `needs: ${item.needed.join(', ')}`);
    assert.equal(
      item.command,
      'rdk submit --channel awesome-list --targets owner/list --category "<CATEGORY>" --apply --ack <ACK> --reason "address review" --plan-digest <DIGEST>',
    );
    assert.equal(status.summary.by_attention.action_required, 1);
    assert.equal(status.summary.by_state.open, 1);
  } finally {
    removeRepo(cwd);
  }
});

test('buildDistributionStatus maps recorded ledger status when live is off', async () => {
  const cwd = ledgerRepo([
    { channel: 'awesome-list', target: 'a/b', pr_url: PR1, status: 'listed' },
    { channel: 'awesome-list', target: 'c/d', pr_url: PR2, status: 'closed' },
    { channel: 'awesome-list', target: 'e/f', pr_url: PR3, status: 'submitted' },
    { channel: 'mcp-directory-form', target: 'mcp.so', status: 'prepared' },
  ]);
  try {
    const status = await buildDistributionStatus({ cwd, loaded: {}, live: false, now: () => NOW });

    assert.deepEqual(status.items.map((item) => item.attention), ['listed', 'terminal', 'none', 'none']);
    assert.equal(status.items[0].why, 'listed (merged)');
    assert.equal(status.items[0].state, null);
    assert.deepEqual(status.items[0].checks, { pass: 0, fail: 0, pending: 0 });
    assert.equal(status.items[1].why, 'closed without merging');
    assert.equal(status.items[2].why, 'no live state');
    assert.equal(status.items[2].action, 'none');
  } finally {
    removeRepo(cwd);
  }
});

test('buildDistributionStatus verifies non-gh-pr channels live without ever calling gh', async () => {
  const cwd = ledgerRepo([
    { channel: 'mcp-official-registry', target: 'mcp.so', status: 'submitted' },
    { channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted' },
  ]);
  try {
    const { gh, calls } = ghStub({
      [PR1]: raw({ state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', url: PR1 }),
    });
    const unusedFetch = async () => {
      throw new Error('fetch must not be called for a record without server_name');
    };

    const status = await buildDistributionStatus({ cwd, loaded: {}, gh, fetchImpl: unusedFetch, live: true, now: () => NOW });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['pr', 'view', PR1, '-R', 'owner/list', '--json', 'state,isDraft,reviewDecision,latestReviews,reviews,comments,statusCheckRollup,mergeStateStatus,mergeable,labels,updatedAt,closedAt,mergedAt,url,commits']);
    assert.equal(status.items[0].attention, 'terminal');
    assert.equal(status.items[0].presence, 'unlisted');
    assert.equal(status.items[0].state, null);
    assert.equal(status.items[1].attention, 'listed');
    assert.equal(status.items[1].state, 'MERGED');
    assert.equal(status.items[1].presence, null);
  } finally {
    removeRepo(cwd);
  }
});

test('buildDistributionStatus verifies crawl presence through the injected fetch and snapshots it', async () => {
  const rows = [{ channel: 'skills-sh', target: 'skills-sh', url: 'https://github.com/owner/repo', status: 'prepared', dedupe_key: 'skills-sh:skills-sh' }];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called for a crawl row');
    };
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(url);
      return { ok: true, status: 200, text: async () => 'crawl me: https://github.com/owner/repo' };
    };

    const status = await buildDistributionStatus({ cwd, loaded: {}, gh: boom, fetchImpl, live: true, now: () => NOW });

    assert.deepEqual(fetchCalls, ['https://www.skills.sh/sitemap-skills-1.xml']);
    const item = status.items[0];
    assert.equal(item.state, null);
    assert.equal(item.is_draft, null);
    assert.equal(item.review_decision, null);
    assert.equal(item.merge_state, null);
    assert.deepEqual(item.checks, { pass: 0, fail: 0, pending: 0 });
    assert.equal(item.presence, 'listed');
    assert.equal(item.url, 'https://www.skills.sh/sitemap-skills-1.xml');
    assert.equal(item.checked_at, NOW);
    assert.equal(item.attention, 'listed');
    assert.deepEqual(item.needed, []);
    assert.equal(status.summary.by_attention.listed, 1);
    assert.equal(status.summary.by_state.unknown, 1);

    const cache = readTrackingCache(cwd);
    assert.deepEqual(cache.snapshots[snapshotKey(rows[0])], {
      presence: 'listed',
      url: 'https://www.skills.sh/sitemap-skills-1.xml',
      checked_at: NOW,
      fetched_at: NOW,
    });
  } finally {
    removeRepo(cwd);
  }
});

test('buildDistributionStatus is read-only to the committed ledger and upserts live snapshots into the cache', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted' }];
  const cwd = ledgerRepo(rows);
  try {
    const ledgerPath = join(cwd, '.discoverability', 'submissions.json');
    const before = readFileSync(ledgerPath, 'utf8');
    const { gh } = ghStub({
      [PR1]: raw({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', url: PR1 }),
    });

    await buildDistributionStatus({ cwd, loaded: {}, gh, live: true, now: () => NOW });

    assert.equal(readFileSync(ledgerPath, 'utf8'), before);
    assert.ok(!existsSync(join(cwd, '.discoverability', 'cache', 'tracking.json.corrupt-0')));

    const cachePath = trackingCachePath(cwd);
    assert.ok(existsSync(cachePath));
    const cache = readTrackingCache(cwd);
    const key = snapshotKey(rows[0]);
    assert.deepEqual(cache.snapshots[key], {
      state: 'OPEN',
      review_decision: 'APPROVED',
      checks: { pass: 1, fail: 0, pending: 0 },
      close_reason: null,
      last_push: '2026-10-05T12:00:00Z',
      fetched_at: NOW,
    });
  } finally {
    removeRepo(cwd);
  }
});

test('buildDistributionStatus summary counts match the items', async () => {
  const cwd = ledgerRepo([
    { channel: 'awesome-list', target: 'a', pr_url: PR1, status: 'submitted' },
    { channel: 'awesome-list', target: 'b', pr_url: PR2, status: 'submitted' },
    { channel: 'awesome-list', target: 'c', pr_url: PR3, status: 'submitted' },
    { channel: 'awesome-list', target: 'd', pr_url: PR4, status: 'submitted' },
    { channel: 'awesome-list', target: 'e', pr_url: PR5, status: 'submitted' },
    { channel: 'awesome-list', target: 'f', pr_url: PR6, status: 'submitted' },
    { channel: 'npm-registry', target: 'repo-aeo', status: 'prepared' },
  ]);
  try {
    const { gh } = ghStub({
      [PR1]: raw({ reviewDecision: 'CHANGES_REQUESTED', url: PR1 }),
      [PR2]: raw({ reviewDecision: 'APPROVED', url: PR2 }),
      [PR3]: raw({ reviewDecision: 'REVIEW_REQUIRED', updatedAt: '2026-10-05T00:00:00Z', url: PR3 }),
      [PR4]: raw({ reviewDecision: 'REVIEW_REQUIRED', updatedAt: '2026-09-01T00:00:00Z', url: PR4 }),
      [PR5]: raw({ state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', url: PR5 }),
      [PR6]: raw({ state: 'CLOSED', url: PR6 }),
    });
    const unusedFetch = async () => {
      throw new Error('fetch must not be called for a record without package identity');
    };

    const status = await buildDistributionStatus({ cwd, loaded: {}, gh, fetchImpl: unusedFetch, live: true, now: () => NOW });

    assert.deepEqual(status.items.map((item) => item.attention), [
      'action_required',
      'approved',
      'awaiting_review',
      'stale',
      'listed',
      'terminal',
      'terminal',
    ]);
    assert.deepEqual(status.summary.by_attention, {
      action_required: 1,
      awaiting_review: 1,
      approved: 1,
      stale: 1,
      none: 0,
      listed: 1,
      terminal: 2,
    });
    assert.deepEqual(status.summary.by_state, { open: 4, merged: 1, closed: 1, unknown: 1 });

    const recomputedAttention = {};
    const recomputedState = {};
    for (const item of status.items) {
      recomputedAttention[item.attention] = (recomputedAttention[item.attention] || 0) + 1;
      const bucket = item.state === 'OPEN' ? 'open' : item.state === 'MERGED' ? 'merged' : item.state === 'CLOSED' ? 'closed' : 'unknown';
      recomputedState[bucket] = (recomputedState[bucket] || 0) + 1;
    }
    for (const key of Object.keys(status.summary.by_attention)) {
      assert.equal(status.summary.by_attention[key], recomputedAttention[key] || 0);
    }
    for (const key of Object.keys(status.summary.by_state)) {
      assert.equal(status.summary.by_state[key], recomputedState[key] || 0);
    }
  } finally {
    removeRepo(cwd);
  }
});

test('renderDistributionStatus prints a header, a target line and the pr_url and command when present', async () => {
  const cwd = ledgerRepo([{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted' }]);
  try {
    const { gh } = ghStub({ [PR1]: raw({ reviewDecision: 'CHANGES_REQUESTED', url: PR1 }) });
    const status = await buildDistributionStatus({ cwd, loaded: {}, gh, live: true, now: () => NOW });

    const text = renderDistributionStatus(status);

    assert.ok(text.startsWith('# distribution'));
    assert.ok(text.includes('- owner/list [action_required]'));
    assert.ok(text.includes(PR1));
    assert.ok(text.includes('--apply --ack'));
  } finally {
    removeRepo(cwd);
  }
});

test('renderDistributionStatus prints the url on the target line for presence items', async () => {
  const rows = [{ channel: 'skills-sh', target: 'skills.sh', url: 'https://github.com/owner/repo', status: 'prepared', dedupe_key: 'skills-sh:skills.sh' }];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called for a crawl row');
    };
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'https://github.com/owner/repo' });
    const status = await buildDistributionStatus({ cwd, loaded: {}, gh: boom, fetchImpl, live: true, now: () => NOW });

    const text = renderDistributionStatus(status);

    assert.ok(text.includes('- skills.sh [listed] https://www.skills.sh/sitemap-skills-1.xml'));
  } finally {
    removeRepo(cwd);
  }
});