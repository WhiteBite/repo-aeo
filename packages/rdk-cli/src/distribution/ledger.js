/**
 * The distribution campaign ledger (.discoverability/submissions.json):
 * committed state, never auto-repaired. Status machine:
 * prepared -> submitted -> listed, with terminal negatives
 * rejected|closed|unlisted|failed that allow one retry.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMaintainer } from './tracking/attention.js';

const BLOCKING_STATUSES = new Set(['prepared', 'submitted', 'open', 'merged', 'listed']);

export function submissionsPath(cwd = process.cwd()) {
  return join(cwd, '.discoverability', 'submissions.json');
}

/** Reads the campaign ledger; null means present but unparsable (committed state, never auto-repaired). */
export function readLedger(cwd = process.cwd()) {
  const path = submissionsPath(cwd);
  if (!existsSync(path)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

/** Appends rows and returns the written ledger; null means the existing ledger is unparsable and was left untouched. */
export function appendRecords(cwd, rows) {
  const existing = readLedger(cwd);
  if (existing === null) return null;
  const path = submissionsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const merged = [...existing, ...rows];
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

/** Rewrites the whole ledger atomically; null means the existing ledger is unparsable and was left untouched. */
export function writeLedger(cwd, rows) {
  if (readLedger(cwd) === null) return null;
  const path = submissionsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
  renameSync(tmp, path);
  return rows;
}

/** Replaces rows whose dedupe_key or pr_url matches (shallow merge), appends the rest; null means the existing ledger is unparsable and was left untouched. */
export function upsertRecords(cwd, rows) {
  const existing = readLedger(cwd);
  if (existing === null) return null;
  const next = [...existing];
  for (const row of rows) {
    const key = row.dedupe_key || row.pr_url;
    const idx = next.findIndex((entry) => (entry.dedupe_key || entry.pr_url) === key);
    if (idx === -1) next.push(row);
    else next[idx] = { ...next[idx], ...row };
  }
  return writeLedger(cwd, next);
}

/** Maps a hydrated PR onto a ledger status transition; null means no transition. */
export function syncTransition(hydrated) {
  if (hydrated.merged) return 'listed';
  if (hydrated.state === 'CLOSED') return 'closed';
  if (hydrated.review_decision === 'CHANGES_REQUESTED') return 'needs_changes';
  const reviews = Array.isArray(hydrated.reviews) ? hydrated.reviews : [];
  if (reviews.some((review) => review && isMaintainer(review.authorAssociation) && review.state === 'CHANGES_REQUESTED')) return 'needs_changes';
  return null;
}

/** Applies hydrated PR states to ledger rows; pure, returns the new rows and the list of changes. */
export function applySync(rows, hydratedByKey, { at }) {
  const changes = [];
  const nextRows = rows.map((row) => {
    const key = row.dedupe_key || row.pr_url;
    const hydrated = hydratedByKey[key];
    if (!hydrated) return row;
    const next = syncTransition(hydrated);
    if (next === null || next === row.status) return row;
    changes.push({ key, from: row.status, to: next });
    const updated = { ...row, status: next, synced_at: at };
    if (typeof hydrated.close_reason === 'string' && hydrated.close_reason !== '') updated.close_reason = hydrated.close_reason;
    return updated;
  });
  return { rows: nextRows, changes };
}

/** True while a submission is in flight or already landed; terminal negatives allow one retry. */
export function isBlocking(record) {
  return Boolean(record) && BLOCKING_STATUSES.has(record.status);
}

/**
 * Projects a record's status through a live probe result. probeResult carries
 * the PR state ('open' | 'merged' | 'closed'); null keeps the recorded
 * status. A merged PR means the entry is listed; a closed PR is a terminal
 * negative; an open PR means the submission is in flight.
 */
export function projectStatus(record, probeResult) {
  const recorded = record && typeof record.status === 'string' ? record.status : null;
  if (!probeResult || typeof probeResult !== 'object' || typeof probeResult.state !== 'string') return recorded;
  if (probeResult.state === 'merged') return 'listed';
  if (probeResult.state === 'closed') return 'closed';
  if (probeResult.state === 'open') return 'submitted';
  return recorded;
}
