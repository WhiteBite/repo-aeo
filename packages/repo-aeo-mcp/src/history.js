/**
 * Local metric history so the server can report trends between calls
 * ("your npm quality score went 0.62 -> 0.81 over the last month").
 * Storage is a JSON file under .discoverability/cache/ (git-ignored).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_POINTS = 500;
const LOCK_STALE_MS = 2000;
const LOCK_ATTEMPTS = 4;
const LOCK_RETRY_MS = 50;

export function historyPath(cwd = process.cwd()) {
  return join(cwd, '.discoverability', 'cache', 'metrics.json');
}

export function readHistory(cwd = process.cwd()) {
  const path = historyPath(cwd);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    try {
      renameSync(path, join(dirname(path), `metrics.json.corrupt-${Date.now()}`));
    } catch {
      // best-effort forensics: rotating the corrupt file aside must never fail the read
    }
    return {};
  }
}

export function writeHistory(history, cwd = process.cwd()) {
  const path = historyPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `metrics.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  try {
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

function lockDir(cwd = process.cwd()) {
  return `${historyPath(cwd)}.lock`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// mkdir is atomic on every platform, so the lock directory is the cross-process mutex
async function acquireLock(cwd) {
  const lock = lockDir(cwd);
  try {
    mkdirSync(dirname(lock), { recursive: true });
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lock);
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return false;
    }
    let stale = false;
    try {
      stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
    } catch {
      stale = false;
    }
    if (stale) {
      try {
        rmSync(lock, { recursive: true, force: true });
      } catch {
        return false;
      }
    }
    await sleep(LOCK_RETRY_MS);
  }
  return false;
}

function releaseLock(cwd) {
  try {
    rmSync(lockDir(cwd), { recursive: true, force: true });
  } catch {
    // a stuck lock dir is stolen by the stale timeout on a later record
  }
}

/** Appends one data point for a metric and returns the stored point. Best-effort: skips the write when the lock cannot be taken. */
export async function record(metric, value, cwd = process.cwd()) {
  const locked = await acquireLock(cwd);
  if (!locked) return { at: new Date().toISOString(), value, skipped: true };
  try {
    const history = readHistory(cwd);
    const point = { at: new Date().toISOString(), value };
    const series = Array.isArray(history[metric]) ? history[metric] : [];
    series.push(point);
    history[metric] = series.slice(-MAX_POINTS);
    try {
      writeHistory(history, cwd);
    } catch {
      // best-effort by contract: an unwritable cache (e.g. read-only mount) must never fail a read-only tool call
    }
    return point;
  } finally {
    releaseLock(cwd);
  }
}

/** Returns the most recent points for a metric (oldest first). */
export function series(metric, limit = 30, cwd = process.cwd()) {
  const history = readHistory(cwd);
  const points = Array.isArray(history[metric]) ? history[metric] : [];
  return points.slice(-limit);
}

/** Computes a simple first -> last trend for a numeric metric. */
export function trend(metric, cwd = process.cwd()) {
  const points = series(metric, 30, cwd);
  if (points.length === 0) return { metric, points: 0, first: null, last: null, delta: null, direction: 'unknown' };
  const numbers = points.map((point) => point.value).filter((value) => typeof value === 'number');
  if (numbers.length === 0) return { metric, points: points.length, first: null, last: null, delta: null, direction: 'unknown' };
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  const delta = Math.round((last - first) * 1000) / 1000;
  return {
    metric,
    points: numbers.length,
    first,
    last,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    since: points[0].at,
    latest: points[points.length - 1].at,
  };
}

export function listMetrics(cwd = process.cwd()) {
  return Object.keys(readHistory(cwd));
}
