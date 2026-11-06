/**
 * Distribution channel descriptors: the places an artifact can be submitted
 * to. `mechanism` names the executor module in mechanisms/ that performs the
 * submission; `when` names a predicate evaluated against the artifact
 * inventory by applicableChannels.
 */

export const CHANNEL_DESCRIPTOR_FIELDS = Object.freeze([
  'id',
  'mechanism',
  'artifact',
  'accepts',
  'summary',
  'when',
  'automatable',
  'probe',
  'endpoint',
  'method',
  'auth',
  'kind',
  'channelId',
  'dedupe',
  'formUrl',
  'fields',
  'checkUrl',
]);

const PREDICATES = {
  has_repo: (inventory) => Boolean(inventory.git_host && inventory.git_owner && inventory.git_repo),
  has_mcp_server: (inventory) => Boolean(inventory.has_mcp_server),
  has_skill: (inventory) => Boolean(inventory.has_skill),
  has_npm_package: (inventory) => Boolean(inventory.has_npm_package),
};

export const CHANNELS = [
  {
    id: 'awesome-list',
    mechanism: 'git-pr',
    artifact: 'readme-row',
    accepts: ['repo', 'mcp-server', 'skill', 'npm-package'],
    summary: 'Curated GitHub lists (awesome-*): one README row per project, added by a pull request against the list.',
    when: 'has_repo',
    automatable: true,
    probe: 'gh-pr',
  },
  {
    id: 'mcp-official-registry',
    mechanism: 'http-json',
    artifact: 'server.json',
    accepts: ['mcp-server'],
    summary: 'The official MCP server registry: one server.json registration per MCP server, submitted to the listing API with a bearer token.',
    when: 'has_mcp_server',
    automatable: true,
    probe: 'http-search',
    endpoint: 'https://registry.modelcontextprotocol.io/v0/servers',
    method: 'POST',
    auth: { env: 'MCP_REGISTRY_TOKEN' },
  },
  {
    id: 'mcp-directory-form',
    mechanism: 'web-form',
    artifact: 'form-payload',
    accepts: ['mcp-server'],
    summary: 'The mcp.so directory: entries land through a human-operated web form; rdk prepares the payload and the exact field checklist.',
    when: 'has_mcp_server',
    automatable: false,
    probe: 'none',
    formUrl: 'https://mcp.so/submit?type=server',
    fields: ['name', 'url', 'description', 'category'],
  },
  {
    id: 'skills-sh',
    mechanism: 'passive',
    artifact: 'none',
    accepts: ['skill'],
    summary: 'skills.sh: crawls public skill directories on its own - nothing to submit, presence is verified after the fact.',
    when: 'has_skill',
    automatable: false,
    probe: 'crawl',
    checkUrl: 'https://www.skills.sh/sitemap.xml',
  },
  {
    id: 'npm-registry',
    mechanism: 'cli-publish',
    artifact: 'npm-tarball',
    accepts: ['npm-package'],
    summary: 'The npm registry: the tarball lands through npm publish, which rdk never runs; it prepares the artifact name and the publish checklist.',
    when: 'has_npm_package',
    automatable: false,
    probe: 'registry-read',
  },
  {
    id: 'telegram-dev',
    mechanism: 'social-api',
    artifact: 'community-post',
    accepts: ['repo', 'npm-package'],
    summary: 'A Telegram dev channel: the rendered community post is delivered to the channel chat through the Bot API with a bot token.',
    when: 'has_repo',
    automatable: true,
    probe: 'social-api',
    endpoint: 'https://api.telegram.org/bot{BOT_TOKEN_ENV}/sendMessage',
    method: 'POST',
    auth: { env: 'TELEGRAM_BOT_TOKEN' },
    kind: 'telegram-dev',
    channelId: '@rdk_devs',
  },
  {
    id: 'devto',
    mechanism: 'social-api',
    artifact: 'community-post',
    accepts: ['repo', 'npm-package'],
    summary: 'dev.to: the rendered community post is published as a draft article through the dev.to API with an API key.',
    when: 'has_repo',
    automatable: true,
    probe: 'social-api',
    endpoint: 'https://dev.to/api/articles',
    method: 'POST',
    auth: { env: 'DEVTO_API_KEY' },
    kind: 'devto',
  },
];

export function channelById(id) {
  return CHANNELS.find((channel) => channel.id === id) || null;
}

export function applicableChannels(inventory) {
  return CHANNELS.filter((channel) => {
    const applies = PREDICATES[channel.when];
    return applies ? applies(inventory) : false;
  });
}
