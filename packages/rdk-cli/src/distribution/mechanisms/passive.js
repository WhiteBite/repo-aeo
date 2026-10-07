/**
 * The passive distribution mechanism: channels that crawl on their own
 * (skills.sh-style indexes, ingestion directories, GitHub topics). There is
 * nothing to submit, so the plan is the crawlability precondition checklist
 * and execute only reports it; presence is verified after the fact by
 * fetching the channel's checkUrl and looking for the project URL in it.
 */

const PRECONDITIONS = [
  { id: 'public-repo', requirement: 'the repository is public so crawlers can reach it' },
  { id: 'llms-txt', requirement: 'llms.txt is served at the repository root' },
  { id: 'topics-set', requirement: 'GitHub topics are set so topic crawls surface the project' },
];

export function describe() {
  return {
    id: 'passive',
    summary: 'Auto-crawled channels (indexes, ingestion directories, GitHub topics): nothing to submit - meet the crawlability preconditions and verify presence after the fact.',
  };
}

/** The precondition checklist as the plan; pure, so it is a digestable offline preview. */
export function plan({ channel } = {}) {
  const id = channel && typeof channel.id === 'string' && channel.id !== '' ? channel.id : 'passive';
  return PRECONDITIONS.map((precondition) => ({
    channel: id,
    precondition: precondition.id,
    requirement: precondition.requirement,
  }));
}

export function execute({ item, channel, url } = {}) {
  const id = channel && typeof channel.id === 'string' && channel.id !== '' ? channel.id : 'passive';
  const checkUrl = channel && typeof channel.checkUrl === 'string' && channel.checkUrl !== '' ? channel.checkUrl : null;
  const requirement = item && typeof item.requirement === 'string' && item.requirement !== '' ? item.requirement : null;
  const lines = [
    `## ${id}`,
    requirement ? `precondition: ${requirement}` : 'precondition: unknown',
    'nothing to submit - this channel crawls on its own',
    checkUrl ? `presence is verified later at ${checkUrl}` : 'no check URL configured - presence cannot be verified after the fact',
  ];
  const result = { ok: true, lines, checklist: { steps: PRECONDITIONS.map((precondition) => precondition.requirement) } };
  if (item && item.precondition === 'public-repo') {
    result.record = {
      channel: id,
      url: url || null,
      target: id,
      status: 'prepared',
      submitted_at: new Date().toISOString(),
    };
  }
  return result;
}

/** How to probe a record's live state: the project URL to look for on the channel's index page. */
export function probe(record) {
  const ref = record && typeof record.url === 'string' && record.url !== '' ? record.url : null;
  return { kind: 'crawl', ref };
}

const GITHUB_REPO_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)/;

/**
 * Verifies presence after the fact: fetches the channel's checkUrl through
 * the injected fetchImpl (global fetch only when none is injected) and
 * resolves to { status: 'listed' | 'unlisted' }; absent, unreachable or
 * malformed inputs resolve to 'unlisted' instead of throwing.
 */
export async function verify({ record, channel, fetchImpl } = {}) {
  const fetcher = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  try {
    const { ref } = probe(record);
    const checkUrl = channel && typeof channel.checkUrl === 'string' && channel.checkUrl !== '' ? channel.checkUrl : null;
    if (!ref || !checkUrl) return { status: 'unlisted' };
    const response = await fetcher(checkUrl);
    if (!response || response.ok === false || (typeof response.status === 'number' && response.status >= 400)) {
      return { status: 'unlisted' };
    }
    const text = await response.text();
    if (typeof text !== 'string') return { status: 'unlisted' };
    // sitemap-style indexes list /<owner>/<repo>/<skill> entries, not the GitHub URL
    const match = GITHUB_REPO_URL.exec(ref);
    const token = match ? `/${match[1]}/${match[2]}/` : null;
    return { status: text.includes(ref) || (token !== null && text.includes(token)) ? 'listed' : 'unlisted' };
  } catch {
    return { status: 'unlisted' };
  }
}
