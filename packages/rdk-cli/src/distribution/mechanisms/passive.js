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
const SITEMAP_LOC = /<loc>([^<]*)<\/loc>/g;
// sanity bound: a bloated or hostile index must not force unbounded shard fetches
const MAX_SITEMAP_SHARDS = 50;

/** Verifies presence after the fact by fetching the channel's checkUrl
 * through the injected fetchImpl (falling back to global fetch) and
 * resolving to { status: 'listed' | 'unlisted' | 'unknown' }: 'listed' when
 * the page carries the project URL; 'unlisted' only on a definitive absence
 * (HTTP 404 or a 2xx page without it); 'unknown' on missing identity,
 * transport failures and any other HTTP status. A checkUrl serving a sitemap
 * index is followed shard by shard: every <loc> shard is fetched through the
 * same fetcher and searched alongside the index body, 'unlisted' is reported
 * only after the whole index was read, and a shard that throws, returns null
 * or answers any status other than 2xx or 404 resolves to 'unknown'.
 */
export async function verify({ record, channel, fetchImpl } = {}) {
  const fetcher = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  try {
    const { ref } = probe(record);
    const checkUrl = channel && typeof channel.checkUrl === 'string' && channel.checkUrl !== '' ? channel.checkUrl : null;
    if (!ref || !checkUrl) return { status: 'unknown' };
    const response = await fetcher(checkUrl);
    if (!response) return { status: 'unknown' };
    const status = typeof response.status === 'number' ? response.status : 0;
    if (status === 404) return { status: 'unlisted' };
    if (status < 200 || status >= 300) return { status: 'unknown' };
    const text = await response.text();
    if (typeof text !== 'string') return { status: 'unknown' };
    // sitemap-style indexes list /<owner>/<repo>/<skill> entries, not the GitHub URL
    const match = GITHUB_REPO_URL.exec(ref);
    const token = match ? `/${match[1]}/${match[2]}/` : null;
    const carries = (body) => body.includes(ref) || (token !== null && body.includes(token));
    if (!text.includes('<sitemapindex')) return { status: carries(text) ? 'listed' : 'unlisted' };
    const shards = [...text.matchAll(SITEMAP_LOC)].map((entry) => entry[1].trim());
    if (shards.length === 0 || shards.length > MAX_SITEMAP_SHARDS) return { status: 'unknown' };
    const bodies = [text];
    for (const shardUrl of shards) {
      const shard = await fetcher(shardUrl);
      if (!shard) return { status: 'unknown' };
      const shardStatus = typeof shard.status === 'number' ? shard.status : 0;
      if (shardStatus !== 404 && (shardStatus < 200 || shardStatus >= 300)) return { status: 'unknown' };
      const shardText = await shard.text();
      if (typeof shardText !== 'string') return { status: 'unknown' };
      bodies.push(shardText);
    }
    return { status: bodies.some(carries) ? 'listed' : 'unlisted' };
  } catch {
    return { status: 'unknown' };
  }
}
