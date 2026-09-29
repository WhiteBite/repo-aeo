/**
 * Link health probing. Only used with an explicit --online flag: the audit is
 * offline by default so the skill works without network access.
 */
import { execFile } from 'node:child_process';
import { TOOL_HOME } from './repo.js';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|tgz|mp4|woff2?)$/i;
const USER_AGENT = `rdk-link-check/0.1 (+${TOOL_HOME})`;

export function isProbeable(url) {
  if (typeof url !== 'string' || url === '') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !SKIP_EXTENSIONS.test(url);
}

/** Fallback probe via curl, for environments where fetch() cannot reach the network. */
async function curlProbe(url, timeoutMs) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-L', '--max-time', String(seconds), '-A', USER_AGENT, url],
      { timeout: timeoutMs + 2000 },
    );
    const status = Number.parseInt(String(stdout).trim(), 10);
    if (!Number.isFinite(status) || status === 0) return { url, status: null, ok: false, error: 'curl returned no status' };
    return { url, status, ok: status < 400, error: null };
  } catch (error) {
    const code = error && error.code;
    const message = code === 127 ? 'curl not available' : `curl failed (${code || 'unknown'})`;
    return { url, status: null, ok: false, error: message };
  }
}

/** Probes one URL with HEAD/GET via fetch, falling back to curl on network errors. */
export async function probeUrl(url, { timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT },
      });
    }
    return { url, status: response.status, ok: response.status < 400, error: null };
  } catch (error) {
    // A network-level failure (proxy, egress restriction) is not proof that the
    // link is dead, so retry with curl before reporting it.
    const fallback = await curlProbe(url, timeoutMs);
    if (fallback.ok || fallback.status !== null) return fallback;
    return { url, status: null, ok: false, error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Probes a bounded number of URLs with limited concurrency. */
export async function probeUrls(urls, { timeoutMs = 6000, concurrency = 4 } = {}) {
  const queue = [...urls];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const url = queue.shift();
      results.push(await probeUrl(url, { timeoutMs }));
    }
  });
  await Promise.all(workers);
  return results;
}
