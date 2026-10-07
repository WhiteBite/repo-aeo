/** Live hydration of recorded submissions: gh-pr via the gh runner, fetch channels via their verifiers; never throws. */
import { countChecks, isMaintainer } from './attention.js';
import { channelById } from '../channels.js';
import * as passive from '../mechanisms/passive.js';
import * as httpJson from '../mechanisms/httpJson.js';
import * as cliPublish from '../mechanisms/cliPublish.js';

const GH_PR_FIELDS = 'state,isDraft,reviewDecision,latestReviews,reviews,comments,statusCheckRollup,mergeStateStatus,mergeable,labels,updatedAt,closedAt,mergedAt,url,commits';

export const GH_PR_BATCH_MIN = 10;

const BATCH_PR_FIELDS =
  'state isDraft reviewDecision mergeable mergeStateStatus mergedAt url ' +
  'latestReviews(first:100){nodes{author{login} state submittedAt}} ' +
  'reviews(first:100){nodes{author{login} state submittedAt}} ' +
  'comments(first:100){nodes{author{login} createdAt}} ' +
  'statusCheckRollup{contexts(first:100){nodes{... on CheckRun{name status conclusion} ... on StatusContext{context state}}}} ' +
  'commits(last:1){nodes{commit{committedDate}}}';

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

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

function parsePrRef(url) {
  if (typeof url !== 'string') return null;
  const match = PR_URL.exec(url);
  if (!match) return null;
  return { owner: match[1], name: match[2], number: Number(match[3]) };
}

export function isGhPrRow(row) {
  const descriptor = row && row.channel ? channelById(row.channel) : null;
  const kind = (descriptor && descriptor.probe) || (row && row.pr_url ? 'gh-pr' : null);
  return kind === 'gh-pr';
}

function viewFromGraphNode(node) {
  return {
    ...node,
    statusCheckRollup: node.statusCheckRollup?.contexts?.nodes ?? [],
    latestReviews: node.latestReviews?.nodes ?? [],
    reviews: node.reviews?.nodes ?? [],
    comments: node.comments?.nodes ?? [],
    commits: (node.commits?.nodes ?? []).map((entry) => entry?.commit ?? {}),
  };
}

export function hydrateGitPrBatch({ entries, gh, cwd }) {
  const results = new Map();
  const parsed = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const url = entry && entry.pr_url;
    const ref = parsePrRef(url);
    if (ref) parsed.push({ url, ref });
    else results.set(url, { ok: false, kind: 'gh-pr', recorded: true });
  }

  let data = null;
  if (parsed.length > 0) {
    try {
      const aliases = [];
      const declarations = [];
      const variables = {};
      parsed.forEach(({ ref }, index) => {
        declarations.push(`$o${index}: String!`, `$n${index}: String!`, `$p${index}: Int!`);
        variables[`o${index}`] = ref.owner;
        variables[`n${index}`] = ref.name;
        variables[`p${index}`] = ref.number;
        aliases.push(`pr${index}: repository(owner:$o${index}, name:$n${index}){ pullRequest(number:$p${index}){ ${BATCH_PR_FIELDS} } }`);
      });
      const result = gh(['api', 'graphql', '--input', '-'], { cwd, input: JSON.stringify({ query: `query(${declarations.join(' ')}){ ${aliases.join(' ')} }`, variables }) });
      if (result && result.ok) data = JSON.parse(result.stdout).data ?? null;
    } catch {
      data = null;
    }
  }

  parsed.forEach(({ url }, index) => {
    const repository = data ? data[`pr${index}`] : null;
    const node = repository && typeof repository === 'object' ? repository.pullRequest : null;
    if (node && typeof node === 'object') results.set(url, { ok: true, kind: 'gh-pr', normalized: normalizeGhPrView(viewFromGraphNode(node)) });
    else results.set(url, { ok: false, kind: 'gh-pr', recorded: true });
  });
  return results;
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

export async function hydrateByProbe({ entry, channel, gh, fetchImpl, cwd, now = () => new Date().toISOString(), batch = null }) {
  const kind = (channel && channel.probe) || (entry && entry.pr_url ? 'gh-pr' : null);
  try {
    if (kind === 'gh-pr') {
      const prehydrated = batch ? batch.get(entry && entry.pr_url) : undefined;
      if (prehydrated) return prehydrated;
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
