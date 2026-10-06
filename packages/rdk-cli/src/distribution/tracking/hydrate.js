/**
 * Live hydration of recorded submissions: turns a `gh pr view --json` payload
 * into the normalized snapshot shape via the injected gh runner, and degrades
 * to the recorded state whenever the runner is missing, fails or emits
 * unparsable output. Never throws.
 */
import { countChecks } from './attention.js';

const GH_PR_FIELDS = 'state,isDraft,reviewDecision,latestReviews,reviews,comments,statusCheckRollup,mergeStateStatus,mergeable,labels,updatedAt,closedAt,mergedAt,url,commits';

function lastPush(raw) {
  let latest = null;
  for (const commit of raw.commits ?? []) {
    const date = commit.committedDate;
    if (date != null && (latest === null || date > latest)) latest = date;
  }
  return latest ?? raw.updatedAt ?? null;
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
    comments: (raw.comments ?? []).map((c) => ({ createdAt: c.createdAt, authorAssociation: c.authorAssociation })),
    last_push: lastPush(raw),
    updatedAt: raw.updatedAt ?? null,
    close_reason: raw.stateReason ?? null,
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

export function hydrateByProbe({ probe, entry, gh, cwd }) {
  if (probe.kind === 'gh-pr') return hydrateGitPr({ entry, gh, cwd });
  return { ok: false, recorded: true, kind: probe.kind };
}
