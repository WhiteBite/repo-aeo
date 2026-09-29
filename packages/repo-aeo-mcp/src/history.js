/**
 * Local metric history so the server can report trends between calls
 * ("your npm quality score went 0.62 -> 0.81 over the last month").
 * Storage is a JSON file under .discoverability/cache/ (git-ignored).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_POINTS = 500;

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

/** Appends one data point for a metric and returns the stored point. */
export function record(metric, value, cwd = process.cwd()) {
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
