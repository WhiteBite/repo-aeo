/** Live hydration of recorded submissions: gh-pr via the gh runner, fetch channels via their verifiers; never throws. */
import { countChecks, isMaintainer } from './attention.js';
import * as passive from '../mechanisms/passive.js';
import * as httpJson from '../mechanisms/httpJson.js';
import * as cliPublish from '../mechanisms/cliPublish.js';

const GH_PR_FIELDS = 'state,isDraft,reviewDecision,latestReviews,reviews,comments,statusCheckRollup,mergeStateStatus,mergeable,labels,updatedAt,closedAt,mergedAt,url,commits';

function lastPush(raw) {
  let latest = null;
  for (const commit of raw.commits ?? []) {
    const date = commit.committedDate;
    if (date != null && (latest === null || date > latest)) latest = date;
  }
  return latest ?? raw.updatedAt ?? null;
}

function closeReason(raw) {
  if (raw.state !== 'CLOSED') return null;
  let maintainer = null;
  let last = null;
  for (const comment of raw.comments ?? []) {
    if (!comment) continue;
    last = comment;
    if (isMaintainer(comment.authorAssociation)) maintainer = comment;
  }
  const chosen = maintainer || last;
  const body = chosen ? chosen.body : null;
  return typeof body === 'string' ? body.slice(0, 500) : null;
}

export function normalizeGhPrView(raw) {
  return {
    state: raw.state ?? null,
    is_draft: Boolean(raw.isDraft),
    review_decision: raw.reviewDecision ?? null,
    merge_state: raw.mergeStateStatus ?? null,
    merged: raw.mergedAt != null,
    checks: countChecks(raw.statusCheckRollup),
    reviews: (raw.latestReviews ?? raw.reviews ?? []).map((r) => ({ state: r.state, authorAssociation: r.authorAssociation })),
    comments: (raw.comments ?? []).map((c) => ({ createdAt: c.createdAt, authorAssociation: c.authorAssociation, body: c.body ?? '' })),
    last_push: lastPush(raw),
    updatedAt: raw.updatedAt ?? null,
    close_reason: closeReason(raw),
    url: raw.url ?? null,
  };
}

export function hydrateGitPr({ entry, gh, cwd }) {
  try {
    const result = gh(['pr', 'view', entry.pr_url, '-R', entry.target, '--json', GH_PR_FIELDS], { cwd });
    if (!result || !result.ok) {
      const stderr = result && typeof result.stderr === 'string' ? result.stderr.trim().slice(0, 200) : '';
      return { ok: false, error: `gh pr view failed for ${entry.pr_url}${stderr ? `: ${stderr}` : ''}` };
    }
    const raw = JSON.parse(result.stdout);
    return { ok: true, normalized: normalizeGhPrView(raw), raw };
  } catch (error) {
    return { ok: false, error: `gh pr view failed for ${entry.pr_url}: ${error && error.message ? error.message : String(error)}` };
  }
}

function presenceUrl(kind, entry, channel) {
  if (kind === 'crawl') return (channel && channel.checkUrl) || null;
  if (kind === 'http-search') {
    return entry && typeof entry.server_name === 'string' && entry.server_name !== ''
      ? `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(entry.server_name)}/versions/latest`
      : null;
  }
  if (kind === 'registry-read') return (entry && entry.registry_url) || null;
  return null;
}

async function verifyPresence(kind, { entry, channel, fetchImpl }) {
  if (kind === 'crawl') return passive.verify({ record: entry, channel, fetchImpl });
  if (kind === 'http-search') return httpJson.verify({ record: entry, fetchImpl });
  return cliPublish.verify({ record: entry, fetchImpl });
}

export async function hydrateByProbe({ entry, channel, gh, fetchImpl, cwd, now = () => new Date().toISOString() }) {
  const kind = (channel && channel.probe) || (entry && entry.pr_url ? 'gh-pr' : null);
  try {
    if (kind === 'gh-pr') {
      if (!entry || !entry.pr_url) return { ok: false, kind, recorded: true };
      return { ...hydrateGitPr({ entry, gh, cwd }), kind };
    }
    if (kind === 'crawl' || kind === 'http-search' || kind === 'registry-read') {
      const verified = await verifyPresence(kind, { entry, channel, fetchImpl });
      if (!verified || typeof verified.status !== 'string') {
        return { ok: false, kind, error: `${kind} verifier returned no status` };
      }
      return { ok: true, kind, normalized: { presence: verified.status, checked_at: now(), url: presenceUrl(kind, entry, channel) } };
    }
    return { ok: false, kind, recorded: true };
  } catch (error) {
    return { ok: false, kind, error: `${kind} probe failed: ${error && error.message ? error.message : String(error)}` };
  }
}
