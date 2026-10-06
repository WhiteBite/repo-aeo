/**
 * The distribution campaign ledger (.discoverability/submissions.json):
 * committed state, never auto-repaired. Status machine:
 * prepared -> submitted -> listed, with terminal negatives
 * rejected|closed|unlisted|failed that allow one retry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
