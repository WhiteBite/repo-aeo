/**
 * Canonical distribution status: projects the committed ledger through live
 * probes into one deterministic object for the CLI, MCP and future dashboard
 * surfaces. Reads .discoverability/submissions.json, never writes it; live
 * probe snapshots live only in the volatile cache.
 */
import { readLedger } from '../ledger.js';
import { channelById } from '../channels.js';
import { hydrateByProbe, hydrateGitPrBatch, isGhPrRow, GH_PR_BATCH_MIN } from './hydrate.js';
import { evaluateAttention, neededFor, commandFor } from './attention.js';
import { readTrackingCache, writeTrackingCache, snapshotKey } from './cache.js';

export const DISTRIBUTION_SCHEMA = 'rdk-distribution/1';

const ATTENTION_KEYS = ['action_required', 'awaiting_review', 'approved', 'stale', 'none', 'listed', 'terminal'];
const STATE_KEYS = ['open', 'merged', 'closed', 'unknown'];

function emptyCounts(keys) {
  const counts = {};
  for (const key of keys) counts[key] = 0;
  return counts;
}

function stateBucket(state) {
  if (state === 'OPEN') return 'open';
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return 'unknown';
}

function whyFor(attention, needed, item) {
  const presence = item && item.presence ? item.presence : null;
  if (attention === 'action_required') return `needs: ${needed.join(', ')}`;
  if (attention === 'awaiting_review') return 'waiting on review';
  if (attention === 'approved') return 'approved, ready to merge';
  if (attention === 'listed') return presence ? 'listed on the channel' : 'listed (merged)';
  if (attention === 'terminal') return presence === 'unlisted' ? 'not present on the channel' : 'closed without merging';
  if (attention === 'stale') return 'no activity for 7 days';
  return 'no live state';
}

async function projectRow(row, { cwd, gh, fetchImpl, live, generated_at, now, batch = null }) {
  const descriptor = row.channel ? channelById(row.channel) : null;

  let normalized = null;
  let hasLive = false;
  if (live) {
    const hydrated = await hydrateByProbe({ entry: row, channel: descriptor, gh, fetchImpl, cwd, now, batch });
    hasLive = Boolean(hydrated && hydrated.ok && hydrated.normalized);
    normalized = hasLive ? hydrated.normalized : null;
  }

  const attention = evaluateAttention(normalized, row, { hasLive, now: generated_at });
  const needed = neededFor(attention, normalized || {});
  const action = needed[0] || attention;
  const command = commandFor({ channel: row.channel, target: row.target, pr_url: row.pr_url, attention, fork: row.fork }, {});
  const presence = normalized && typeof normalized.presence === 'string' ? normalized : null;
  const pr = normalized && !presence ? normalized : null;

  return {
    hasLive,
    normalized,
    item: {
      channel: row.channel ?? null,
      target: row.target ?? null,
      pr_url: row.pr_url ?? null,
      state: pr ? pr.state : null,
      is_draft: pr ? pr.is_draft : null,
      review_decision: pr ? pr.review_decision : null,
      merge_state: pr ? pr.merge_state : null,
      checks: pr ? pr.checks : { pass: 0, fail: 0, pending: 0 },
      presence: presence ? presence.presence : null,
      url: presence ? presence.url : null,
      checked_at: presence ? presence.checked_at : null,
      attention,
      needed,
      why: whyFor(attention, needed, { presence: presence ? presence.presence : null, state: pr ? pr.state : null }),
      action,
      command,
    },
  };
}

export async function buildDistributionStatus({ cwd, options = {}, gh, git, fetchImpl, now = () => new Date().toISOString(), live = true }) {
  const generated_at = now();
  const rows = readLedger(cwd) || [];
  const by_attention = emptyCounts(ATTENTION_KEYS);
  const by_state = emptyCounts(STATE_KEYS);
  const cache = readTrackingCache(cwd);
  let cacheDirty = false;
  const items = [];

  const ghPrRows = rows.filter(isGhPrRow);
  const batch = live && ghPrRows.length >= GH_PR_BATCH_MIN ? hydrateGitPrBatch({ entries: ghPrRows, gh, cwd }) : null;

  for (const row of rows) {
    const { hasLive, normalized, item } = await projectRow(row, { cwd, gh, fetchImpl, live, generated_at, now, batch });
    items.push(item);
    if (by_attention[item.attention] !== undefined) by_attention[item.attention] += 1;
    by_state[stateBucket(item.state)] += 1;
    if (hasLive) {
      cache.snapshots[snapshotKey(row)] = normalized.presence
        ? { presence: normalized.presence, url: normalized.url, checked_at: normalized.checked_at, fetched_at: generated_at }
        : {
            state: normalized.state,
            review_decision: normalized.review_decision,
            checks: normalized.checks,
            close_reason: normalized.close_reason,
            last_push: normalized.last_push,
            fetched_at: generated_at,
          };
      cacheDirty = true;
    }
  }

  if (cacheDirty) writeTrackingCache(cwd, cache);

  return {
    schema_version: DISTRIBUTION_SCHEMA,
    generated_at,
    summary: { total: items.length, by_attention, by_state },
    items,
  };
}

export function renderDistributionStatus(status) {
  const lines = ['# distribution'];
  for (const item of status.items) {
    const suffix = item.presence && item.url ? ` ${item.url}` : '';
    lines.push(`- ${item.target ?? ''} [${item.attention}]${suffix}`);
    if (item.pr_url) lines.push(item.pr_url);
    if (item.command) lines.push(item.command);
  }
  return lines.join('\n');
}