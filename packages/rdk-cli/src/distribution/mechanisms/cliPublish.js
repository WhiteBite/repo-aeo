/**
 * The cli-publish distribution mechanism: prepares an npm package for a
 * registry channel. Listings-only by product policy - this module never runs
 * a publish command, never writes and never spawns a process; execute returns
 * the artifact name plus the exact checklist of commands for a human or CI to
 * run themselves.
 */

export const POLICY = Object.freeze({ mode: 'listings-only', runs_publish_commands: false });

function packageName(config, pkg) {
  return (pkg && pkg.name) || (config && config.project && config.project.name) || 'package';
}

function packageVersion(pkg) {
  return String((pkg && pkg.version) || '0.0.0');
}

function artifactName(name, version) {
  return `${String(name).replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

function registryUrl(name) {
  return `https://registry.npmjs.org/${name}`;
}

function stepsFor(name, version) {
  const scoped = String(name).startsWith('@');
  return ['npm pack', scoped ? 'npm publish --access public' : 'npm publish', `npm view ${name}@${version}`];
}

export function describe() {
  return {
    id: 'cli-publish',
    summary: 'Prepare an npm package for a registry channel: RDK never publishes - it returns the artifact name and the exact commands for a human or CI to run.',
  };
}

export function plan({ channel, config, pkg } = {}) {
  const id = channel && channel.id ? channel.id : 'npm-registry';
  const name = packageName(config, pkg);
  const version = packageVersion(pkg);
  return [{
    channel: id,
    package: name,
    version,
    artifact: artifactName(name, version),
    registry_url: registryUrl(name),
  }];
}

export function buildChecklist({ channel, config, pkg } = {}) {
  const name = packageName(config, pkg);
  const version = packageVersion(pkg);
  return { steps: stepsFor(name, version) };
}

export function execute({ item, channel, cwd, config } = {}) {
  const id = (channel && channel.id) || item.channel || 'npm-registry';
  const steps = stepsFor(item.package, item.version);
  const lines = [
    `## ${id}`,
    `artifact: ${item.artifact} (run \`npm pack\` to build it)`,
    'prepared - RDK never publishes; run the checklist yourself or in CI',
    ...steps.map((step) => `- \`${step}\``),
  ];
  return {
    ok: true,
    lines,
    record: {
      channel: id,
      package: item.package,
      version: item.version,
      artifact: item.artifact,
      registry_url: item.registry_url,
      status: 'prepared',
    },
    checklist: { steps },
  };
}

/** How to probe a record's live state: the registry URL for the published package. */
export function probe(record) {
  const ref = record && typeof record.registry_url === 'string' && record.registry_url !== '' ? record.registry_url : null;
  return { kind: 'registry-read', ref };
}
