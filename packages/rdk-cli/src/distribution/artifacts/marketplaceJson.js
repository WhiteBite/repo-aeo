/**
 * Deterministic marketplace.json renderers for the Claude Code and Codex
 * plugin marketplaces: both are pure functions of the project config and the
 * package manifest, with no I/O. The owner is taken from
 * `project.copyright_holder` when present, else derived from the first GitHub
 * link, and omitted entirely when neither yields one.
 */

const GITHUB_LINK_KEYS = ['homepage', 'docs', 'demo', 'issues'];

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function ownerFromLinks(links) {
  if (!links) return null;
  for (const key of GITHUB_LINK_KEYS) {
    if (typeof links[key] === 'string') {
      const match = links[key].match(/^https?:\/\/github\.com\/([^/]+)\//);
      if (match) return match[1];
    }
  }
  return null;
}

function ownerOf(config) {
  const holder = config?.project?.copyright_holder;
  if (typeof holder === 'string' && holder !== '') return holder;
  return ownerFromLinks(config?.links) || null;
}

function projectName(config, pkg) {
  return slug(config?.project?.name || pkg?.name || '');
}

export function renderClaudeMarketplace(config, pkg) {
  const name = projectName(config, pkg);
  const doc = { name, plugins: [{ name, source: './' }] };
  const owner = ownerOf(config);
  if (owner) doc.owner = owner;
  return doc;
}

export function renderCodexMarketplace(config, pkg) {
  const name = projectName(config, pkg);
  const doc = { name, plugins: [{ name, source: './', policy: { installation: 'manual' } }] };
  const owner = ownerOf(config);
  if (owner) doc.owner = owner;
  return doc;
}
