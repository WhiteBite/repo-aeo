/**
 * The http-json distribution mechanism: registry channels that accept a JSON
 * payload over an authenticated HTTP API. This never publishes packages or
 * releases; it only performs listing registrations. execute() sends exactly
 * two kinds of requests through the injected fetchImpl (global fetch only as
 * a fallback): a GET dedupe check and the submission POST/PUT itself.
 */

export function describe() {
  return {
    id: 'http-json',
    summary: 'Submit a JSON payload to a registry listing API with a bearer token, dedupe against an existing listing, and record the listing URL.',
  };
}

/** Builds per-target plan items; pure, so the same input always yields the same output. */
export function plan({ targets, channel, payload }) {
  const endpoint = channel && typeof channel.endpoint === 'string' ? channel.endpoint : null;
  const method = channel && typeof channel.method === 'string' && channel.method !== '' ? channel.method.toUpperCase() : 'POST';
  return (Array.isArray(targets) ? targets : []).map((t) => ({ target: String(t), endpoint, method, payload: payload === undefined ? null : payload }));
}

export async function execute({ item, channel, fetchImpl, env }) {
  const lines = ['', `## ${item.target}`];
  const fail = (error) => ({ ok: false, error, lines });
  const fetcher = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  const safeText = async (res) => { try { return await res.text(); } catch { return ''; } };
  const request = async (url, init) => {
    try {
      return { ok: true, res: await fetcher(url, init) };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  };
  if (channel && channel.automatable === false) {
    const steps = ['Submit the payload to the registry by hand.', `Record the listing URL for "${item.target}" in .discoverability/submissions.json.`];
    lines.push('manual submission required (no API write performed)');
    return { ok: true, lines, record: { target: item.target, status: 'prepared', submitted_at: new Date().toISOString(), url: null }, checklist: { steps } };
  }
  const envName = channel && channel.auth && typeof channel.auth.env === 'string' ? channel.auth.env : '';
  const token = envName ? (env || {})[envName] : undefined;
  if (!token) {
    lines.push(`auth required: set ${envName || 'the channel auth env var'}`);
    return fail(`auth_required: set ${envName || 'the channel auth env var'} to the registry token before submitting`);
  }
  const dedupeUrl = channel && channel.dedupe && typeof channel.dedupe.url === 'string' && channel.dedupe.url !== '' ? channel.dedupe.url : null;
  if (dedupeUrl) {
    const attempt = await request(dedupeUrl, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (!attempt.ok) return fail(`dedupe check for ${item.target} failed: ${attempt.error}`);
    const res = attempt.res;
    if (res.ok) {
      lines.push(`already listed: ${dedupeUrl}`);
      return { ok: true, lines, record: { target: item.target, status: 'listed', submitted_at: new Date().toISOString(), url: dedupeUrl } };
    }
    if (res.status !== 404) {
      const body = await safeText(res);
      return fail(`dedupe check for ${item.target} failed: HTTP ${res.status}${body ? `: ${body.trim().slice(0, 200)}` : ''}`);
    }
  }
  const endpoint = item.endpoint || (channel && channel.endpoint) || null;
  const method = item.method || 'POST';
  const attempt = await request(endpoint, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(item.payload) });
  if (!attempt.ok) return fail(`${item.target}: ${method} ${endpoint} failed: ${attempt.error}`);
  const res = attempt.res;
  if (!res.ok) {
    const body = await safeText(res);
    return fail(`${item.target}: ${method} ${endpoint} failed: HTTP ${res.status}${body ? `: ${body.trim().slice(0, 200)}` : ''}`);
  }
  const text = await safeText(res);
  let url = dedupeUrl;
  try { const parsed = JSON.parse(text); if (parsed && typeof parsed.url === 'string' && parsed.url !== '') url = parsed.url; } catch {}
  lines.push(`submitted: ${url || endpoint}`);
  return { ok: true, lines, record: { target: item.target, status: 'submitted', submitted_at: new Date().toISOString(), url: url || null } };
}

/** How to probe a record's live state: the listing URL returned at submit time. */
export function probe(record) {
  const ref = record && typeof record.url === 'string' && record.url !== '' ? record.url : null;
  return { kind: 'http-search', ref };
}
