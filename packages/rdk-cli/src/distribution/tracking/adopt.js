/**
 * Adoption of pull requests that predate the campaign ledger: discovery of
 * PRs authored by the current account via the injected gh runner, matching
 * against the rdk/<listRepo>/add-<slug> branch convention, pure row
 * derivation and the ledger append. Discovery never throws: a failed or
 * unparsable gh call is skipped.
 */
import { appendRecords } from '../ledger.js';

const SEARCH_FIELDS = 'url,repository,number,title,state,isDraft';
const LIST_FIELDS = 'url,number,title,state,isDraft,headRefName';
const STATUS_BY_STATE = { OPEN: 'open', MERGED: 'listed', CLOSED: 'closed' };

function ghItems(gh, args, cwd) {
  let result;
  try {
    result = gh(args, { cwd });
  } catch {
    return [];
  }
  if (!result || !result.ok || typeof result.stdout !== 'string') return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function prEntry(item, target) {
  const entry = { url: item.url, target, number: item.number ?? null, state: item.state ?? null, isDraft: Boolean(item.isDraft) };
  if (typeof item.headRefName === 'string') entry.headRefName = item.headRefName;
  return entry;
}

/** Cross-repo search plus one pr list per target, merged and deduped by url. */
export function discoverOwnedPrs({ gh, cwd, targets = [] }) {
  const byUrl = new Map();
  for (const item of ghItems(gh, ['search', 'prs', '--author', '@me', '--state', 'all', '--json', SEARCH_FIELDS], cwd)) {
    const target = item && item.repository && typeof item.repository.nameWithOwner === 'string' ? item.repository.nameWithOwner : null;
    if (!item || typeof item.url !== 'string' || item.url === '' || target === null) continue;
    byUrl.set(item.url, prEntry(item, target));
  }
  for (const target of Array.isArray(targets) ? targets : []) {
    for (const item of ghItems(gh, ['pr', 'list', '-R', target, '--author', '@me', '--state', 'all', '--json', LIST_FIELDS], cwd)) {
      if (!item || typeof item.url !== 'string' || item.url === '') continue;
      const existing = byUrl.get(item.url);
      if (existing) {
        if (typeof item.headRefName === 'string') existing.headRefName = item.headRefName;
        continue;
      }
      byUrl.set(item.url, prEntry(item, target));
    }
  }
  return [...byUrl.values()];
}

/** Keeps only PRs whose head branch follows the rdk/<listRepo>/add-<slug> convention. */
export function matchAdoptable(prs) {
  const rows = [];
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || typeof pr.headRefName !== 'string' || !pr.headRefName.startsWith('rdk/')) continue;
    rows.push({ url: pr.url, target: pr.target, branch: pr.headRefName, number: pr.number, state: pr.state });
  }
  return rows;
}

/** Pure; skips adoptables already recorded by pr_url or dedupe_key. */
export function adoptRows(ledger, adoptable) {
  const existing = Array.isArray(ledger) ? ledger : [];
  const prUrls = new Set(existing.map((row) => row && row.pr_url).filter((url) => typeof url === 'string' && url !== ''));
  const dedupeKeys = new Set(existing.map((row) => row && row.dedupe_key).filter((key) => typeof key === 'string' && key !== ''));
  const rows = [];
  for (const item of Array.isArray(adoptable) ? adoptable : []) {
    if (!item || typeof item.url !== 'string' || item.url === '') continue;
    const dedupeKey = `awesome-list:${item.target}`;
    if (prUrls.has(item.url) || dedupeKeys.has(dedupeKey)) continue;
    prUrls.add(item.url);
    dedupeKeys.add(dedupeKey);
    rows.push({
      adopted: true,
      channel: 'awesome-list',
      mechanism: 'git-pr',
      artifact: 'readme-row',
      target: item.target,
      branch: item.branch,
      pr_url: item.url,
      status: STATUS_BY_STATE[item.state] || 'open',
      dedupe_key: dedupeKey,
    });
  }
  return rows;
}

/** The write guard is the caller's responsibility. */
export function applyAdopt(cwd, rows) {
  return appendRecords(cwd, rows);
}
