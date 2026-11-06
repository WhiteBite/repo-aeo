/**
 * Deterministic community-post artifact: the ready-to-post message for a
 * community channel, derived only from .discoverability/project.yml and
 * package.json. Pure rendering, no I/O.
 */

export const SHARE_CHANNELS = Object.freeze([
  'reddit-r-webdev',
  'reddit-r-node',
  'reddit-r-programming',
  'telegram-dev',
  'hn-show',
  'twitter-dev',
  'devto',
]);

const REDDIT_POST_URLS = {
  'reddit-r-webdev': 'https://www.reddit.com/r/webdev/submit',
  'reddit-r-node': 'https://www.reddit.com/r/node/submit',
  'reddit-r-programming': 'https://www.reddit.com/r/programming/submit',
};

function hashtags(topics) {
  return topics
    .slice(0, 3)
    .map((topic) => `#${String(topic).toLowerCase().replace(/ /g, '-')}`)
    .join(' ');
}

/** Renders the { title, body, postUrl } triple for a channel kind; null for an unknown kind. */
export function renderShareContent(config, pkg, kind) {
  const project = (config && config.project) || {};
  const name = project.name || (pkg && pkg.name) || '';
  const oneliner = project.one_liner || '';
  const diffs = (config && config.differentiators) || [];
  const homepage = (config && config.links && config.links.homepage) || '';
  const topics = (config && config.keywords && config.keywords.github_topics) || [];
  const tags = hashtags(topics);
  const pkgName = (pkg && pkg.name) || 'repo-aeo';
  const cta = `Try it: npx ${pkgName} audit`;
  switch (kind) {
    case 'reddit-r-webdev':
    case 'reddit-r-node':
    case 'reddit-r-programming':
      return {
        title: `${oneliner} [${name}]`,
        body: `${oneliner}\n\n${diffs.map((d) => `- ${d}`).join('\n')}\n\n${tags}`,
        postUrl: REDDIT_POST_URLS[kind],
      };
    case 'telegram-dev':
      return {
        title: `${name} — ${oneliner}`,
        body: `${oneliner}\n\n${diffs.map((d) => `• ${d}`).join('\n')}\n\n${homepage}`,
        postUrl: '',
      };
    case 'hn-show':
      return {
        title: `Show HN: ${name} — ${oneliner}`,
        body: '',
        postUrl: 'https://news.ycombinator.com/submit',
      };
    case 'twitter-dev':
      return {
        title: oneliner,
        body: `1/4 ${oneliner}\n\n2/4 ${diffs.slice(0, 2).join('\n')}\n\n3/4 ${cta}\n\n${homepage}`,
        postUrl: 'https://twitter.com/intent/tweet',
      };
    case 'devto':
      return {
        title: oneliner,
        body: `${oneliner}\n\n## Why\n\n${diffs.map((d) => `- ${d}`).join('\n')}\n\n## Quickstart\n\n\`npx ${pkgName} audit\``,
        postUrl: 'https://dev.to/new',
      };
    default:
      return null;
  }
}
