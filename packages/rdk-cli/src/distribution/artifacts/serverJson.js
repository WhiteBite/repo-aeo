/**
 * Deterministic server.json artifact: the registry discovery document for a
 * project, derived only from .discoverability/project.yml and package.json.
 */

export function renderServerJson(config, pkg) {
  const project = config?.project || {};
  const name = project.name || pkg?.name || 'project';
  const description = project.one_liner || project.description || pkg?.description || '';
  const version = String(pkg?.version || '0.0.0');
  const repositoryUrl = (config?.links && config.links.repository) ||
    (config?.links && config.links.homepage) ||
    (pkg?.repository && pkg.repository.url) || null;
  const identifier = pkg?.name || name;
  const doc = {
    name,
    description,
    version,
    packages: [{ registry_type: 'npm', identifier, version }],
  };
  if (repositoryUrl) doc.repository = { url: repositoryUrl };
  return doc;
}

/** The value the published package must carry as mcpName. */
export function mcpOwnershipMarker(name) {
  return String(name);
}
