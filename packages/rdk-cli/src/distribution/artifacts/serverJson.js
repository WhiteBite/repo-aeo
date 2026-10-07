/**
 * Deterministic server.json artifact: the registry discovery document for a
 * project, derived only from .discoverability/project.yml and package.json.
 */

const GITHUB_LINK_KEYS = ['homepage', 'docs', 'demo', 'issues'];

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
  const fromLinks = ownerFromLinks(config?.links);
  if (fromLinks) return fromLinks;
  const holder = config?.project?.copyright_holder;
  return typeof holder === 'string' && holder !== '' ? holder : null;
}

export function renderServerJson(config, pkg) {
  const project = config?.project || {};
  const name = project.name || pkg?.name || 'project';
  const description = project.one_liner || project.description || pkg?.description || '';
  const version = String(pkg?.version || '0.0.0');
  const repositoryUrl = (config?.links && config.links.repository) ||
    (config?.links && config.links.homepage) ||
    (pkg?.repository && pkg.repository.url) || null;
  const identifier = pkg?.name || name;
  const mcpName = typeof pkg?.mcpName === 'string' && pkg.mcpName.trim() !== '' ? pkg.mcpName : null;
  const doc = {
    name: mcpName || mcpOwnershipMarker(name, ownerOf(config)),
    description,
    version,
    packages: [{ registry_type: 'npm', identifier, version }],
  };
  if (repositoryUrl) doc.repository = { url: repositoryUrl };
  return doc;
}

/** The value the published package must carry as mcpName: io.github.<owner>/<name> when the owner is known, else the bare name. */
export function mcpOwnershipMarker(name, owner) {
  const clean = String(name);
  return owner ? `io.github.${owner}/${clean}` : clean;
}
