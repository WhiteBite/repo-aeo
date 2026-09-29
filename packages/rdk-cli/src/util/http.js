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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(response) {
  const seconds = Number.parseInt(response.headers.get('retry-after') || '', 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function fetchOnce(url, method, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Probes one URL with HEAD/GET via fetch, falling back to curl on network errors. */
export async function probeUrl(url, { timeoutMs = 6000, retries = 2, retryBaseMs = 500 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      let response = await fetchOnce(url, 'HEAD', timeoutMs);
      if (response.status === 405 || response.status === 501) {
        response = await fetchOnce(url, 'GET', timeoutMs);
      }
      if (retryable(response.status) && attempt < retries) {
        await response.body?.cancel().catch(() => {});
        const wait = retryAfterMs(response) ?? retryBaseMs * 2 ** attempt;
        if (wait > 0) await sleep(wait);
        continue;
      }
      return { url, status: response.status, ok: response.status < 400, error: null };
    } catch (error) {
      // a network-level failure is not proof the link is dead: fall back to curl before reporting it
      const fallback = await curlProbe(url, timeoutMs);
      if (fallback.ok || fallback.status !== null) return fallback;
      return { url, status: null, ok: false, error: String((error && error.message) || error) };
    }
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
