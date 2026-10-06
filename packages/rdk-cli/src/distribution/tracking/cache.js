/**
 * Volatile tracking cache (.discoverability/cache/tracking.json): probe
 * snapshots of submitted items, git-ignored and safe to lose. The committed
 * ledger at .discoverability/submissions.json is never read or written here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA_VERSION = 'rdk-tracking/1';

function emptyCache() {
  return { schema_version: SCHEMA_VERSION, snapshots: {} };
}

export function trackingCachePath(cwd = process.cwd()) {
  return join(cwd, '.discoverability', 'cache', 'tracking.json');
}

export function readTrackingCache(cwd = process.cwd()) {
  const path = trackingCachePath(cwd);
  if (!existsSync(path)) return emptyCache();
  let parsed = null;
  let valid = false;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
    valid = Boolean(parsed && typeof parsed === 'object' && parsed.snapshots && typeof parsed.snapshots === 'object');
  } catch {
    valid = false;
  }
  if (valid) return { schema_version: parsed.schema_version || SCHEMA_VERSION, snapshots: parsed.snapshots };
  try {
    renameSync(path, join(dirname(path), `tracking.json.corrupt-${Date.now()}`));
  } catch {
    // best-effort forensics: rotating the corrupt file aside must never fail the read
  }
  return emptyCache();
}

export function writeTrackingCache(cwd, cache) {
  const path = trackingCachePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `tracking.json.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // best-effort cleanup of the abandoned temp file
    }
    throw error;
  }
  return path;
}

export function snapshotKey(entry) {
  return entry.dedupe_key || entry.pr_url || `${entry.channel}:${entry.target}`;
}
