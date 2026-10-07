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

function graphNode(overrides = {}) {
  return {
    state: 'OPEN',
    isDraft: false,
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    mergedAt: null,
    url: null,
    latestReviews: { nodes: [] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    statusCheckRollup: { contexts: { nodes: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] } },
    commits: { nodes: [{ commit: { committedDate: '2026-10-05T12:00:00Z' } }] },
    ...overrides,
  };
}

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

    const result = await trackCommand({ cwd, options: {}, config: {}, ghRunner: gh, now: () => NOW });

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

    const jsonPreview = await trackCommand({ cwd, options: { adopt: true, json: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(jsonPreview.ok, true);
    const parsedJson = JSON.parse(jsonPreview.output);
    assert.equal(parsedJson.plan_digest, preview.plan_digest);
    assert.equal(parsedJson.rows.length, 1);
    assert.equal(parsedJson.rows[0].pr_url, ADOPT_PR);

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

test('track --sync forwards the injected fetch and previews prepared -> listed for a crawl row', async () => {
  const rows = [{ channel: 'skills-sh', target: 'skills.sh', url: 'https://github.com/owner/repo', status: 'prepared', dedupe_key: 'skills-sh:skills.sh' }];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called for a crawl row');
    };
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(url);
      return { ok: true, status: 200, text: async () => 'https://github.com/owner/repo' };
    };

    const preview = await trackCommand({ cwd, options: { sync: true }, config: {}, ghRunner: boom, fetchImpl, now: () => NOW });
    assert.equal(preview.ok, true, preview.output);
    assert.deepEqual(fetchCalls, ['https://www.skills.sh/sitemap-skills-1.xml']);
    assert.match(preview.output, /skills-sh:skills\.sh: prepared -> listed/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    removeRepo(cwd);
  }
});

test('track --mark previews a digest, refuses an unguarded --apply and rewrites only the matching row', async () => {
  const other = { channel: 'awesome-list', target: 'other/list', pr_url: PR2, status: 'open', dedupe_key: 'awesome-list:other/list' };
  const rows = [
    { channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' },
    other,
  ];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called for --mark');
    };

    const preview = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(preview.ok, true);
    assert.equal(preview.exitCode, 0);
    assert.match(preview.output, /- owner\/list: submitted -> listed/);
    assert.doesNotMatch(preview.output, /other\/list/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);

    const jsonPreview = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed', json: true }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(jsonPreview.ok, true);
    const parsed = JSON.parse(jsonPreview.output);
    assert.deepEqual(parsed.changes, [{ key: 'awesome-list:owner/list', from: 'submitted', to: 'listed' }]);
    assert.equal(parsed.plan_digest, preview.plan_digest);

    const noAck = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed', apply: true }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(noAck.ok, false);
    assert.equal(noAck.exitCode, 1);
    assert.match(noAck.error, /--ack/);

    const noReason = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed', apply: true, ack: ACK }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(noReason.ok, false);
    assert.match(noReason.output, /--reason/);

    const noDigest = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed', apply: true, ack: ACK, reason: 'unit test mark' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(noDigest.ok, false);
    assert.equal(noDigest.code, 'plan_digest_required');
    assert.equal(JSON.parse(readFileSync(ledgerPath(cwd), 'utf8')).length, 2);

    const applied = await trackCommand({
      cwd,
      options: { mark: 'owner/list', status: 'listed', apply: true, ack: ACK, reason: 'unit test mark', plan_digest: preview.plan_digest },
      config: {},
      ghRunner: boom,
      now: () => NOW,
    });
    assert.equal(applied.ok, true, applied.output);
    assert.match(applied.output, /Reason logged: unit test mark/);
    assert.match(applied.output, /Marked 1 submission in \.discoverability\/submissions\.json\./);
    const ledger = JSON.parse(readFileSync(ledgerPath(cwd), 'utf8'));
    assert.deepEqual(ledger[0], {
      channel: 'awesome-list',
      target: 'owner/list',
      pr_url: PR1,
      status: 'listed',
      dedupe_key: 'awesome-list:owner/list',
      synced_at: NOW,
    });
    assert.deepEqual(ledger[1], other);
  } finally {
    removeRepo(cwd);
  }
});

test('track --mark fails on unknown target, invalid status, missing --status and mode conflicts', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called when --mark fails');
    };

    const unknownTarget = await trackCommand({ cwd, options: { mark: 'nope/list', status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(unknownTarget.ok, false);
    assert.equal(unknownTarget.exitCode, 1);
    assert.match(unknownTarget.error, /no ledger row for target "nope\/list"/);

    const badStatus = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'shipped' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(badStatus.ok, false);
    assert.equal(badStatus.exitCode, 1);
    assert.match(badStatus.error, /unknown status "shipped"/);

    const noStatus = await trackCommand({ cwd, options: { mark: 'owner/list' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(noStatus.ok, false);
    assert.equal(noStatus.exitCode, 1);
    assert.match(noStatus.error, /--status is required with --mark/);

    const withAdopt = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed', adopt: true }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(withAdopt.ok, false);
    assert.match(withAdopt.error, /pass only one of --adopt, --sync, --mark/);

    const withSync = await trackCommand({ cwd, options: { mark: 'owner/list', status: 'listed', sync: true }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(withSync.ok, false);
    assert.match(withSync.error, /pass only one of --adopt, --sync, --mark/);

    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    removeRepo(cwd);
  }
});

test('track --mark rejects a valueless or empty --mark and a --status without --mark', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called when --mark is invalid');
    };

    const valueless = await trackCommand({ cwd, options: { mark: true, status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(valueless.ok, false);
    assert.equal(valueless.exitCode, 1);
    assert.match(valueless.error, /--mark.+requires a target/);
    assert.match(valueless.output, /--mark.+requires a target/);

    const empty = await trackCommand({ cwd, options: { mark: '', status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /--mark.+requires a target/);

    const loneStatus = await trackCommand({ cwd, options: { status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(loneStatus.ok, false);
    assert.equal(loneStatus.exitCode, 1);
    assert.match(loneStatus.error, /--status.+requires.+--mark/);

    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    removeRepo(cwd);
  }
});

test('track --mark refuses an ambiguous target and --channel picks the row', async () => {
  const rows = [
    { channel: 'mcp-official-registry', target: 'demo-project', url: 'https://github.com/owner/repo', status: 'submitted', dedupe_key: 'mcp-official-registry:demo-project' },
    { channel: 'npm-registry', target: 'demo-project', url: 'https://github.com/owner/repo', status: 'prepared', dedupe_key: 'npm-registry:demo-project' },
  ];
  const cwd = ledgerRepo(rows);
  try {
    const boom = () => {
      throw new Error('gh must not be called for --mark');
    };

    const ambiguous = await trackCommand({ cwd, options: { mark: 'demo-project', status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.exitCode, 1);
    assert.match(ambiguous.error, /--channel/);
    assert.match(ambiguous.output, /mcp-official-registry/);
    assert.match(ambiguous.output, /npm-registry/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);

    const preview = await trackCommand({ cwd, options: { mark: 'demo-project', channel: 'npm-registry', status: 'listed' }, config: {}, ghRunner: boom, now: () => NOW });
    assert.equal(preview.ok, true);
    assert.match(preview.output, /- demo-project: prepared -> listed/);
    assert.doesNotMatch(preview.output, /submitted/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);

    const applied = await trackCommand({
      cwd,
      options: { mark: 'demo-project', channel: 'npm-registry', status: 'listed', apply: true, ack: ACK, reason: 'unit test channel disambiguation', plan_digest: preview.plan_digest },
      config: {},
      ghRunner: boom,
      now: () => NOW,
    });
    assert.equal(applied.ok, true, applied.output);
    assert.match(applied.output, /Marked 1 submission/);
    const ledger = JSON.parse(readFileSync(ledgerPath(cwd), 'utf8'));
    assert.deepEqual(ledger[0], rows[0]);
    assert.deepEqual(ledger[1], { ...rows[1], status: 'listed', synced_at: NOW });
  } finally {
    removeRepo(cwd);
  }
});

test('track --sync --json emits parseable JSON with the plan digest', async () => {
  const rows = [{ channel: 'awesome-list', target: 'owner/list', pr_url: PR1, status: 'submitted', dedupe_key: 'awesome-list:owner/list' }];
  const cwd = ledgerRepo(rows);
  try {
    const gh = ghStub({
      view: { [PR1]: () => okJson(raw({ state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z', url: PR1 })) },
    });

    const preview = await trackCommand({ cwd, options: { sync: true, json: true }, config: {}, ghRunner: gh, now: () => NOW });
    assert.equal(preview.ok, true);
    assert.equal(preview.exitCode, 0);
    const parsed = JSON.parse(preview.output);
    assert.deepEqual(parsed.changes, [{ key: 'awesome-list:owner/list', from: 'submitted', to: 'listed' }]);
    assert.equal(parsed.plan_digest, preview.plan_digest);
    assert.match(parsed.plan_digest, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    removeRepo(cwd);
  }
});

test('track --sync batches ten or more gh-pr rows into one graphql call', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    channel: 'awesome-list',
    target: `owner/list${i}`,
    pr_url: `https://github.com/owner/list${i}/pull/${i + 1}`,
    status: 'submitted',
    dedupe_key: `awesome-list:owner/list${i}`,
  }));
  const cwd = ledgerRepo(rows);
  try {
    const calls = [];
    const gh = (args, opts) => {
      calls.push({ args, opts });
      if (args[0] === 'api' && args[1] === 'graphql') {
        const data = {};
        rows.forEach((row, i) => {
          data[`pr${i}`] = { pullRequest: i === 0 ? graphNode({ state: 'CLOSED' }) : graphNode({ url: row.pr_url }) };
        });
        return okJson({ data });
      }
      return { ok: false, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}`, code: 1 };
    };

    const preview = await trackCommand({ cwd, options: { sync: true }, config: {}, ghRunner: gh, now: () => NOW });

    assert.equal(preview.ok, true, preview.output);
    assert.equal(calls.length, 1, 'ten gh-pr rows hydrate through exactly one graphql call');
    assert.deepEqual(calls[0].args, ['api', 'graphql', '--input', '-']);
    assert.match(preview.output, /awesome-list:owner\/list0: submitted -> closed/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(readFileSync(ledgerPath(cwd), 'utf8'), `${JSON.stringify(rows, null, 2)}\n`);
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
    assert.match(result.error, /pass only one of --adopt, --sync, --mark/);
    assert.match(result.output, /Pass only one of --adopt, --sync, --mark\./);
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
