import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackCommand } from '../src/commands/track.js';
import { makeRepo, removeRepo } from './helpers.js';

const NOW = '2026-10-06T00:00:00.000Z';
const ACK = 'I_ACK_RDK_GITHUB_WRITE';
const PR1 = 'https://github.com/owner/list/pull/1';
const PR2 = 'https://github.com/other/list/pull/2';
const ADOPT_PR = 'https://github.com/other/list/pull/7';

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

const okJson = (value) => ({ ok: true, stdout: JSON.stringify(value), stderr: '', code: 0 });

function ghStub({ search, list = {}, view = {} } = {}) {
  return (args, opts) => {
    if (args[0] === 'search') return search ? search(args, opts) : okJson([]);
    if (args[0] === 'pr' && args[1] === 'list') {
      const handler = list[args[3]];
      return handler ? handler(args, opts) : okJson([]);
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const handler = view[args[2]];
      return handler ? handler(args, opts) : { ok: false, stdout: '', stderr: 'not found', code: 1 };
    }
    return { ok: false, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}`, code: 1 };
  };
}

function ledgerRepo(rows) {
  return makeRepo({ '.discoverability/submissions.json': `${JSON.stringify(rows, null, 2)}\n` });
}

const ledgerPath = (cwd) => join(cwd, '.discoverability', 'submissions.json');

test('track default is read-only: header, live items and a byte-identical ledger', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const before = readFileSync(ledgerPath(cwd), 'utf8');
    const gh = ghStub({ view: { [PR1]: () => okJson(raw({ url: PR1 })) } });

    const result = await trackCommand({ cwd, options: {}, config: {}, loaded: {}, ghRunner: gh, now: () => NOW });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.output.startsWith('# rdk track'));
    assert.ok(result.output.includes('- owner/list ['));
    assert.ok(result.output.includes(PR1));
    assert.equal(result.status.schema_version, 'rdk-distribution/1');
    assert.equal(result.status.generated_at, NOW);
    assert.equal(result.status.items.length, 1);
    assert.equal(result.status.items[0].pr_url, PR1);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), before);
  } finally {
    removeRepo(cwd);
  }
});

test('track --json emits only parseable JSON with the distribution schema', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const gh = ghStub({ view: { [PR1]: () => okJson(raw({ url: PR1 })) } });

    const result = await trackCommand({ cwd, options: { json: true }, config: {}, ghRunner: gh, now: () => NOW });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.schema_version, 'rdk-distribution/1');
    assert.equal(parsed.generated_at, NOW);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.summary.total, 1);
    assert.doesNotMatch(result.output, /# rdk track/);
  } finally {
    removeRepo(cwd);
  }
});

test('track --adopt previews a digest, refuses an unguarded --apply and appends rows under the guard', async () => {
  const cwd = ledgerRepo([
    { channel: 'awesome-list', target: 'other/list', pr_url: PR2, status: 'closed' },
  ]);
  try {
    const gh = ghStub({
      search: () => okJson([
        { url: ADOPT_PR, repository: { nameWithOwner: 'other/list' }, number: 7, title: 'Add demo-project', state: 'OPEN', isDraft: false },
      ]),
      list: {
        'other/list': () => okJson([
          { url: ADOPT_PR, number: 7, title: 'Add demo-project', state: 'OPEN', isDraft: false, headRefName: 'rdk/list/add-demo-project' },
        ]),
      },
    });

    const preview = await trackCommand({ cwd, options: { adopt: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(preview.ok, true);
    assert.equal(preview.exitCode, 0);
    assert.match(preview.output, /other\/list/);
    assert.match(preview.output, /rdk\/list\/add-demo-project/);
    assert.ok(preview.output.includes(ADOPT_PR));
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(JSON.parse(readFileSync(ledgerPath(cwd), 'utf8')).length, 1);

    const noAck = await trackCommand({ cwd, options: { adopt: true, apply: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(noAck.ok, false);
    assert.equal(noAck.exitCode, 1);
    assert.match(noAck.error, /--ack/);

    const noReason = await trackCommand({ cwd, options: { adopt: true, apply: true, ack: ACK }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(noReason.ok, false);
    assert.match(noReason.output, /--reason/);

    const noDigest = await trackCommand({ cwd, options: { adopt: true, apply: true, ack: ACK, reason: 'unit test adoption' }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(noDigest.ok, false);
    assert.equal(noDigest.code, 'plan_digest_required');
    assert.equal(JSON.parse(readFileSync(ledgerPath(cwd), 'utf8')).length, 1);

    const applied = await trackCommand({
      cwd,
      options: { adopt: true, apply: true, ack: ACK, reason: 'unit test adoption', plan_digest: preview.plan_digest },
      config: {},
      ghRunner: gh,
      now: () => NOW,
    });
    assert.equal(applied.ok, true, applied.output);
    assert.match(applied.output, /Reason logged: unit test adoption/);
    assert.match(applied.output, /Adopted 1 submission/);
    const ledger = JSON.parse(readFileSync(ledgerPath(cwd), 'utf8'));
    assert.equal(ledger.length, 2);
    assert.deepEqual(ledger[1], {
      adopted: true,
      channel: 'awesome-list',
      mechanism: 'git-pr',
      artifact: 'readme-row',
      target: 'other/list',
      branch: 'rdk/list/add-demo-project',
      pr_url: ADOPT_PR,
      status: 'open',
      dedupe_key: 'awesome-list:other/list',
    });

    const again = await trackCommand({ cwd, options: { adopt: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(again.ok, true);
    assert.match(again.output, /nothing to adopt/);
    assert.equal(JSON.parse(readFileSync(ledgerPath(cwd), 'utf8')).length, 2);
  } finally {
    removeRepo(cwd);
  }
});

test('track --sync --apply rewrites only changed statuses, logs the reason and is idempotent', async () => {
  const unchanged = { channel: 'awesome-list', target: 'other/list', pr_url: PR2, status: 'open', dedupe_key: 'awesome-list:other/list' };
  const rows = [
    { channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' },
    unchanged,
  ];
  const cwd = ledgerRepo(rows);
  try {
    const gh = ghStub({
      view: {
        [PR1]: () => okJson(raw({ state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', url: PR1 })),
        [PR2]: () => okJson(raw({ url: PR2 })),
      },
    });

    const preview = await trackCommand({ cwd, options: { sync: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(preview.ok, true);
    assert.match(preview.output, /awesome-list:owner\/list: submitted -> listed/);
    assert.doesNotMatch(preview.output, /other\/list: open/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);

    const applied = await trackCommand({
      cwd,
      options: { sync: true, apply: true, ack: ACK, reason: 'unit test sync', plan_digest: preview.plan_digest },
      config: {},
      ghRunner: gh,
      now: () => NOW,
    });
    assert.equal(applied.ok, true, applied.output);
    assert.match(applied.output, /awesome-list:owner\/list: submitted -> listed/);
    assert.match(applied.output, /Reason logged: unit test sync/);
    assert.match(applied.output, /Synced 1 submission/);
    const ledger = JSON.parse(readFileSync(ledgerPath(cwd), 'utf8'));
    assert.deepEqual(ledger[0], {
      channel: 'awesome-list',
      target: 'owner/list',
      pr_url: PR1,
      status: 'listed',
      dedupe_key: 'awesome-list:owner/list',
      synced_at: NOW,
    });
    assert.deepEqual(ledger[1], unchanged);

    const afterFirst = readFileSync(ledgerPath(cwd), 'utf8');
    const second = await trackCommand({ cwd, options: { sync: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(second.ok, true);
    assert.match(second.output, /nothing to sync/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), afterFirst);
  } finally {
    removeRepo(cwd);
  }
});

test('track --sync --apply moves a changes-requested PR from submitted to needs_changes', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const gh = ghStub({
      view: { [PR1]: () => okJson(raw({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', url: PR1 })) },
    });

    const preview = await trackCommand({ cwd, options: { sync: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(preview.ok, true);
    assert.match(preview.output, /awesome-list:owner\/list: submitted -> needs_changes/);

    const applied = await trackCommand({
      cwd,
      options: { sync: true, apply: true, ack: ACK, reason: 'unit test needs_changes sync', plan_digest: preview.plan_digest },
      config: {},
      ghRunner: gh,
      now: () => NOW,
    });
    assert.equal(applied.ok, true, applied.output);
    assert.match(applied.output, /awesome-list:owner\/list: submitted -> needs_changes/);
    assert.match(applied.output, /Reason logged: unit test needs_changes sync/);
    const ledger = JSON.parse(readFileSync(ledgerPath(cwd), 'utf8'));
    assert.deepEqual(ledger[0], {
      channel: 'awesome-list',
      target: 'owner/list',
      pr_url: PR1,
      status: 'needs_changes',
      dedupe_key: 'awesome-list:owner/list',
      synced_at: NOW,
    });
  } finally {
    removeRepo(cwd);
  }
});

test('track refuses --adopt together with --sync instead of preferring one', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called when the mode flags conflict');
    };

    const result = await trackCommand({ cwd, options: { adopt: true, sync: true }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /pass either --adopt or --sync, not both/);
    assert.match(result.output, /Pass either --adopt or --sync, not both\./);
    assert.equal(JSON.parse(readFileSync(ledgerPath(cwd), 'utf8')).length, 1);
  } finally {
    removeRepo(cwd);
  }
});

test('track reports an unparsable ledger and never repairs it', async () => {
  const cwd = makeRepo({ '.discoverability/submissions.json': '{ not json' });
  try {
    const boom = () => {
      throw new Error('gh must not be called when the ledger is unparsable');
    };

    const status = await trackCommand({ cwd, options: {}, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(status.ok, false);
    assert.equal(status.exitCode, 1);
    assert.match(status.error, /parse/);

    const sync = await trackCommand({ cwd, options: { sync: true, apply: true, ack: ACK, reason: 'unit test', plan_digest: '0'.repeat(64) }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(sync.ok, false);
    assert.match(sync.error, /parse/);

    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), '{ not json');
  } finally {
    removeRepo(cwd);
  }
});
