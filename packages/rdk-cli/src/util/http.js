/**
 * Link health probing. Only used with an explicit --online flag: the audit is
 * offline by default so the skill works without network access.
 */

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|tgz|mp4|woff2?)$/i;

export function isProbeable(url) {
  if (typeof url !== 'string' || url === '') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !SKIP_EXTENSIONS.test(url);
}

/** Probes one URL with HEAD, falling back to GET. Returns { url, status, ok, error }. */
export async function probeUrl(url, { timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'rdk-link-check/0.1 (+https://github.com/WhiteBite/signal-forge)' },
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'rdk-link-check/0.1 (+https://github.com/WhiteBite/signal-forge)' },
      });
    }
    return { url, status: response.status, ok: response.status < 400, error: null };
  } catch (error) {
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
