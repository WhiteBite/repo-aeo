/**
 * The social-api distribution mechanism: community channels that accept the
 * rendered community post through an authenticated HTTP API. execute() sends
 * exactly one request through the injected fetchImpl (global fetch only as a
 * fallback): the submission POST itself.
 */
import { renderShareContent } from '../artifacts/socialPost.js';

export function describe() {
  return {
    id: 'social-api',
    summary: 'Post the rendered community message to a social channel API with a bearer token and record the post URL.',
  };
}

/** Composes the channel request body from the rendered post; pure. */
function buildPostPayload({ channel, config, pkg }) {
  const kind = channel && typeof channel.kind === 'string' && channel.kind !== '' ? channel.kind : (channel && channel.id) || null;
  const content = renderShareContent(config, pkg, kind);
  if (!content) return null;
  if (kind === 'telegram-dev') {
    return { chat_id: channel && channel.channelId, text: content.body, parse_mode: 'Markdown' };
  }
  if (kind === 'devto') {
    const topics = (config && config.keywords && config.keywords.github_topics) || [];
    return { article: { title: content.title, body_markdown: content.body, tags: topics, published: false } };
  }
  return { title: content.title, content: content.body };
}

/** Builds per-target plan items; pure, so the same input always yields the same output. */
export function plan({ targets, channel, config, pkg }) {
  const endpoint = channel && typeof channel.endpoint === 'string' ? channel.endpoint : null;
  const method = channel && typeof channel.method === 'string' && channel.method !== '' ? channel.method.toUpperCase() : 'POST';
  const payload = buildPostPayload({ channel, config, pkg });
  return (Array.isArray(targets) ? targets : []).map((t) => ({ target: String(t), endpoint, method, payload }));
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
    const steps = ['Post the message to the channel by hand.', `Record the post URL for "${item.target}" in .discoverability/submissions.json.`];
    lines.push('manual submission required (no API write performed)');
    return { ok: true, lines, record: { target: item.target, status: 'prepared', submitted_at: new Date().toISOString(), url: null }, checklist: { steps } };
  }
  const envName = channel && channel.auth && typeof channel.auth.env === 'string' ? channel.auth.env : '';
  const token = envName ? (env || {})[envName] : undefined;
  if (!token) {
    lines.push(`auth required: set ${envName || 'the channel auth env var'}`);
    return fail(`auth_required: set ${envName || 'the channel auth env var'} to the channel token before posting`);
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
  let url = null;
  try { const parsed = JSON.parse(text); if (parsed && typeof parsed.url === 'string' && parsed.url !== '') url = parsed.url; } catch {}
  lines.push(`submitted: ${url || endpoint}`);
  return { ok: true, lines, record: { target: item.target, status: url ? 'listed' : 'submitted', submitted_at: new Date().toISOString(), url } };
}

/** How to probe a record's live state: the post URL returned at submit time. */
export function probe(record) {
  const ref = record && typeof record.url === 'string' && record.url !== '' ? record.url : null;
  return { kind: 'social-api', ref };
}
