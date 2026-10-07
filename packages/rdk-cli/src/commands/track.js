/**
 * `rdk track` — the campaign dashboard over .discoverability/submissions.json:
 * read-only live status by default, `--adopt` to pull pre-ledger rdk/* pull
 * requests into the ledger, `--sync` to rewrite recorded statuses from live
 * probes. Both writes need the same guard chain as submit:
 * --apply --ack --reason --plan-digest.
 */
import { run } from '../util/proc.js';
import { readLedger, applySync, writeLedger } from '../distribution/ledger.js';
import { channelById } from '../distribution/channels.js';
import { ACK_HINT, assertWriteGuards, planDigest } from '../distribution/guard.js';
import { buildDistributionStatus, renderDistributionStatus } from '../distribution/tracking/status.js';
import { discoverOwnedPrs, matchAdoptable, adoptRows, applyAdopt } from '../distribution/tracking/adopt.js';
import { hydrateByProbe } from '../distribution/tracking/hydrate.js';

const GUARD_LINES = {
  ack_mismatch: `Refusing to write: --ack must equal ${ACK_HINT}.`,
  reason_required: 'Refusing to write: pass --reason "<why this change is correct>" so the change is auditable.',
  plan_digest_required: 'Refusing to write: --plan-digest is required so the write binds to the approved preview.',
  plan_digest_mismatch: 'Refusing to write: the plan changed since the approved preview (plan_digest mismatch).',
};

const UNPARSABLE_LEDGER = 'could not parse .discoverability/submissions.json - fix it by hand or restore it from git';

function adoptMode({ cwd, options, config, ledger, gh, lines, fail, refuse }) {
  const targets = [...new Set(ledger.map((row) => row && row.target).filter((target) => typeof target === 'string' && target !== ''))];
  const discovered = discoverOwnedPrs({ gh, cwd, targets });
  const rows = adoptRows(ledger, matchAdoptable(discovered));

  if (rows.length === 0) {
    lines.push('No unrecorded rdk/* pull requests found - nothing to adopt.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: [], plan_digest: null, adopted: [] };
  }

  const digest = planDigest(rows);
  const bound = assertWriteGuards({ options, config, plan: rows });
  if (!bound.ok) return refuse(bound, bound.code === 'plan_digest_mismatch' ? { plan_digest: digest } : {});

  for (const row of rows) {
    lines.push(`- **${row.target}**`);
    lines.push(`  - pr:       ${row.pr_url}`);
    lines.push(`  - branch:   ${row.branch}`);
    lines.push(`  - status:   ${row.status}`);
  }
  lines.push('');

  if (!options.apply) {
    lines.push(`Plan digest: ${digest}`);
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>" --plan-digest <PLAN_DIGEST>` to adopt them into the ledger.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: rows, plan_digest: digest, adopted: [] };
  }

  if (applyAdopt(cwd, rows) === null) {
    lines.push('Could not parse .discoverability/submissions.json - fix it by hand or restore it from git.');
    return fail(UNPARSABLE_LEDGER);
  }
  lines.push(`Reason logged: ${options.reason}`);
  lines.push(`Adopted ${rows.length} submission(s) into .discoverability/submissions.json.`);
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: rows, plan_digest: digest, adopted: rows };
}

function syncMode({ cwd, options, config, ledger, gh, lines, fail, refuse, now }) {
  const hydratedByKey = {};
  for (const row of ledger) {
    const descriptor = row.channel ? channelById(row.channel) : null;
    const probeKind = (descriptor && descriptor.probe) || (row.pr_url ? 'gh-pr' : null);
    const hydrated = hydrateByProbe({ probe: { kind: probeKind, ref: row.pr_url || null }, entry: row, gh, cwd });
    if (hydrated && hydrated.ok && hydrated.normalized) hydratedByKey[row.dedupe_key || row.pr_url] = hydrated.normalized;
  }

  const { rows, changes } = applySync(ledger, hydratedByKey, { at: now() });

  if (changes.length === 0) {
    lines.push('Every recorded submission is already up to date - nothing to sync.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, changes: [] };
  }

  const digest = planDigest(changes);
  const bound = assertWriteGuards({ options, config, plan: changes });
  if (!bound.ok) return refuse(bound, bound.code === 'plan_digest_mismatch' ? { plan_digest: digest } : {});

  for (const change of changes) {
    lines.push(`- ${change.key}: ${change.from} -> ${change.to}`);
  }
  lines.push('');

  if (!options.apply) {
    lines.push(`Plan digest: ${digest}`);
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>" --plan-digest <PLAN_DIGEST>` to sync the ledger.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, changes, plan_digest: digest };
  }

  if (writeLedger(cwd, rows) === null) {
    lines.push('Could not parse .discoverability/submissions.json - fix it by hand or restore it from git.');
    return fail(UNPARSABLE_LEDGER);
  }
  lines.push(`Reason logged: ${options.reason}`);
  lines.push(`Synced ${changes.length} submission(s) in .discoverability/submissions.json.`);
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, changes, plan_digest: digest };
}

export async function trackCommand({ cwd, options = {}, config, loaded, ghRunner, gitRunner, fetchImpl, now = () => new Date().toISOString() }) {
  const gh = ghRunner || ((args, opts = {}) => run('gh', args, { cwd: (opts && opts.cwd) || cwd, timeout: (opts && opts.timeout) || 20000 }));
  const lines = ['# rdk track', ''];
  const fail = (error, extra = {}) => ({ ok: false, error, output: `${lines.join('\n')}\n`, exitCode: 1, ...extra });
  const refuse = (guard, extra = {}) => {
    lines.push(GUARD_LINES[guard.code]);
    const coded = guard.code === 'plan_digest_required' || guard.code === 'plan_digest_mismatch' ? { code: guard.code } : {};
    return fail(guard.error, { ...coded, ...extra });
  };

  if (options.adopt && options.sync) {
    lines.push('Pass either --adopt or --sync, not both.');
    return fail('pass either --adopt or --sync, not both');
  }

  const ledger = readLedger(cwd);
  if (ledger === null) {
    lines.push('Could not parse .discoverability/submissions.json - fix it by hand or restore it from git.');
    return fail(UNPARSABLE_LEDGER);
  }

  if (options.adopt) return adoptMode({ cwd, options, config, ledger, gh, lines, fail, refuse });
  if (options.sync) return syncMode({ cwd, options, config, ledger, gh, lines, fail, refuse, now });

  const status = await buildDistributionStatus({ cwd, loaded, gh, git: gitRunner, fetchImpl, now });
  if (options.json) return { ok: true, output: `${JSON.stringify(status, null, 2)}\n`, exitCode: 0, status };
  return { ok: true, output: `${[...lines, renderDistributionStatus(status)].join('\n')}\n`, exitCode: 0, status };
}

export default { trackCommand };
