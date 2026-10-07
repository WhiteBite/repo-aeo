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

const ABBREVIATED_ACCEPT = 'application/vnd.npm.install-v1+json';

function verifyFetchUrl(record) {
  if (typeof record.registry_url === 'string' && record.registry_url !== '') {
    return record.registry_url.includes(record.package)
      ? record.registry_url.replace(record.package, encodeURIComponent(record.package))
      : record.registry_url;
  }
  return `https://registry.npmjs.org/${encodeURIComponent(record.package)}`;
}

/**
 * Verifies registry presence: GETs the abbreviated metadata document for the
 * record's package through the injected fetchImpl (global fetch only when none
 * is injected) and resolves to { status: 'listed' | 'unlisted' | 'unknown' }.
 * The version counts as listed when it appears in `versions` or equals
 * `dist-tags.latest`; without a recorded version any package document with a
 * `versions` map is listed. 'unlisted' marks only a definitive absence - HTTP
 * 404 or a 2xx document without the recorded version; missing identity,
 * transport and parse failures resolve to 'unknown' instead of throwing.
 */
export async function verify({ record, fetchImpl } = {}) {
  const fetcher = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  try {
    const pkg = record && record.package;
    if (typeof pkg !== 'string' || pkg === '') return { status: 'unknown' };
    const version = typeof record.version === 'string' && record.version !== '' ? record.version : null;
    const response = await fetcher(verifyFetchUrl(record), { headers: { accept: ABBREVIATED_ACCEPT } });
    if (!response) return { status: 'unknown' };
    const status = typeof response.status === 'number' ? response.status : 0;
    if (status === 404) return { status: 'unlisted' };
    if (status < 200 || status >= 300) return { status: 'unknown' };
    const body = JSON.parse(await response.text());
    const versions = body && body.versions;
    if (!versions || typeof versions !== 'object') return { status: 'unlisted' };
    if (!version) return { status: 'listed' };
    if (Object.hasOwn(versions, version)) return { status: 'listed' };
    const latest = body['dist-tags'] && body['dist-tags'].latest;
    return { status: latest === version ? 'listed' : 'unlisted' };
  } catch {
    return { status: 'unknown' };
  }
}
