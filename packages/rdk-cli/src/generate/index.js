/**
 * Deterministic generators. Every artifact is derived from
 * .discoverability/project.yml plus facts read from the repository — the
 * generator never invents claims it cannot source from the config.
 */
import { extname, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { exists, listFiles, readTextIfExists, mtimeMs } from '../util/fs.js';
import { repoOwnerStrict, toolDocUrl } from '../util/repo.js';

/** Renders `key:` (parses back as null) for empty values, `key: "value"` otherwise. */
function yamlScalar(value) {
  if (value === null || value === undefined || value === '') return '';
  return ` ${JSON.stringify(String(value))}`;
}

/** Renders `key: []` for empty lists and `key:\n  - a\n  - b` otherwise. */
function yamlBlock(key, items, indent = '') {
  if (!Array.isArray(items) || items.length === 0) return `${indent}${key}: []`;
  return `${indent}${key}:\n${items.map((item) => `${indent}  - ${JSON.stringify(String(item))}`).join('\n')}`;
}

function scriptsOf(pkg) {
  return (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
}

function commandFor(pkg, candidates, fallback) {
  const scripts = scriptsOf(pkg);
  for (const name of candidates) {
    if (scripts[name]) return `npm run ${name}`;
  }
  return fallback;
}

// Real quickstart commands only: configured in project.yml or backed by an existing package.json script.
export function deriveQuickstartCommands(config, pkg) {
  const quickstart = (config && config.quickstart) || {};
  const scripts = scriptsOf(pkg);
  return {
    install: quickstart.install || (pkg && pkg.name ? `npm install ${pkg.name}` : null),
    run: quickstart.run || (scripts.start ? 'npm run start' : scripts.dev ? 'npm run dev' : null),
    test: quickstart.test || (scripts.test ? 'npm run test' : scripts['test:unit'] ? 'npm run test:unit' : null),
  };
}

/** Markers that separate generated content from hand-written content. */
export const GENERATED_START = '<!-- rdk:generated:start -->';
export const GENERATED_END = '<!-- rdk:generated:end -->';

export const HANDWRITTEN_NOTE = '<!-- Everything below the end marker is preserved by `rdk fix`. Put hand-written context here; the block above is regenerated from .discoverability/project.yml. -->';

const HANDWRITTEN_HEADING = '## Hand-written notes';

function findMarkers(text) {
  const markers = [];
  for (const [kind, marker] of [['start', GENERATED_START], ['end', GENERATED_END]]) {
    let index = text.indexOf(marker);
    while (index !== -1) {
      markers.push({ kind, index, end: index + marker.length });
      index = text.indexOf(marker, index + marker.length);
    }
  }
  return markers.sort((a, b) => a.index - b.index);
}

/**
 * Merges freshly generated content into an existing file:
 *   - no file            -> generated content wrapped in markers + note
 *   - file with markers  -> only the marked region is replaced
 *   - corrupted markers  -> healed: every span collapses into one fresh block
 *   - file without markers that differs from the generated content
 *                        -> treated as hand-edited and left untouched (the
 *                           caller reports it), so `rdk fix` never destroys
 *                           manual work
 */
export function mergeGenerated(existing, generated) {
  const bodyRaw = String(generated).trim();
  if (existing === null || existing === undefined) {
    return `${GENERATED_START}\n${bodyRaw}\n${GENERATED_END}\n\n${HANDWRITTEN_HEADING}\n\n${HANDWRITTEN_NOTE}\n`;
  }
  const text = String(existing);
  const markers = findMarkers(text);
  if (markers.length === 0) return null; // hand-edited legacy file: caller must not overwrite
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = eol === '\r\n' ? bodyRaw.replace(/\n/g, '\r\n') : bodyRaw;
  const head = text.slice(0, markers[0].index);
  const tailRaw = text.slice(markers[markers.length - 1].end);
  const hasEnd = markers.some((marker) => marker.kind === 'end');
  const middles = [];
  let depth = 0;
  for (let i = 0; i < markers.length - 1; i += 1) {
    depth = Math.max(0, depth + (markers[i].kind === 'start' ? 1 : -1));
    if (hasEnd && depth > 0) continue; // inside a start..end span: old generated body
    const chunk = text.slice(markers[i].end, markers[i + 1].index);
    if (chunk.trim() !== '') middles.push(chunk.trim());
  }
  let tail = tailRaw;
  let separated = middles.length > 0;
  if (!hasEnd) {
    // no end marker: spans between markers are old generated body; only text after the last marker may be hand-written
    middles.length = 0;
    separated = false;
    const heading = text.indexOf(HANDWRITTEN_HEADING, markers[0].index);
    if (heading !== -1) {
      tail = text.slice(heading);
      separated = true;
    }
  }
  if (!separated) return `${head}${GENERATED_START}${eol}${body}${eol}${GENERATED_END}${tail}`;
  const parts = [...middles];
  const tailContent = tail.replace(/^(?:\r?\n)+/, '');
  if (tailContent.trim() !== '') parts.push(tailContent);
  return `${head}${GENERATED_START}${eol}${body}${eol}${GENERATED_END}${eol}${eol}${parts.join(eol + eol)}`;
}

/** Source files whose content feeds the generated llms files: README plus docs/*.md. */
function llmsSourceFiles(cwd) {
  const sources = [{ path: 'README.md', mtime: mtimeMs(join(cwd, 'README.md')) }];
  const docsDir = join(cwd, 'docs');
  if (exists(docsDir)) {
    for (const entry of readdirSync(docsDir)) {
      if (/\.md$/i.test(entry)) sources.push({ path: `docs/${entry}`, mtime: mtimeMs(join(docsDir, entry)) });
    }
  }
  return sources;
}

/** One freshness predicate shared by the CLI audit and the MCP tool; managed files drift by content, hand-written by any newer source. */
export function llmsFreshness(cwd, config, pkg) {
  const llmsPath = join(cwd, 'llms.txt');
  const text = readTextIfExists(llmsPath);
  if (text === null) return { exists: false, managed: false, fresh: null };
  const modified = mtimeMs(llmsPath);
  if (text.includes(GENERATED_START) && text.includes(GENERATED_END)) {
    const drifted = generatedDrift(cwd, config, pkg).includes('llms.txt');
    return {
      exists: true,
      managed: true,
      fresh: !drifted,
      driftMs: null,
      modified,
      sources: ['rendered output'],
      newerSources: drifted ? [{ path: 'rendered output', contentDrift: true }] : [],
    };
  }
  const sources = llmsSourceFiles(cwd);
  const newer = sources.filter((source) => source.mtime !== null && source.mtime > modified);
  const driftMs = newer.length > 0 ? Math.max(...newer.map((source) => source.mtime - modified)) : 0;
  return {
    exists: true,
    managed: false,
    fresh: newer.length === 0,
    driftMs,
    modified,
    sources: sources.map((source) => source.path),
    newerSources: newer.map((source) => ({ path: source.path, mtime: source.mtime })),
  };
}

/**
 * Names of the generated llms files whose on-disk content no longer matches the
 * rendered output. Marker-managed files are compared by content (so `rdk fix`
 * clearing the drift is guaranteed); hand-written files without markers fall
 * back to source mtimes, which `rdk fix` never overwrites.
 */
export function generatedDrift(cwd, config, pkg) {
  const readmePath = join(cwd, 'README.md');
  const readme = exists(readmePath) ? readTextIfExists(readmePath) : renderReadme(config, pkg);
  const stale = [];
  const targets = [
    ['llms.txt', renderLlmsTxt(config, pkg, readme)],
    ['llms-full.txt', renderLlmsFullTxt(config, pkg, readme)],
  ];
  for (const [relative, generated] of targets) {
    const path = join(cwd, relative);
    if (!exists(path)) continue;
    const text = readTextIfExists(path);
    if (text.includes(GENERATED_START) && text.includes(GENERATED_END)) {
      if (mergeGenerated(text, generated) !== text) stale.push(relative);
    } else {
      const fileTime = mtimeMs(path);
      const newer = llmsSourceFiles(cwd).some((source) => source.mtime !== null && fileTime !== null && source.mtime > fileTime);
      if (newer) stale.push(relative);
    }
  }
  return stale;
}

export function renderProjectYml(config) {
  const project = config.project || {};
  const keywords = config.keywords || {};
  const links = config.links || {};
  const quickstart = config.quickstart || {};
  const artifacts = config.artifacts || {};
  const safety = config.safety || {};

  return `# Docs: ${toolDocUrl('docs/configuration.md')}

schema_version: ${typeof config.schema_version === 'number' ? config.schema_version : 1}   # config schema revision; rdk warns on any other value

project:
  name:${yamlScalar(project.name)}
  one_liner:${yamlScalar(project.one_liner)}   # 1 sentence, shown as the GitHub description
  description:${yamlScalar(project.description)}
  category:${yamlScalar(project.category || 'library')}   # library | app | template | research | tool | dataset | mcp-server
  copyright_holder:${yamlScalar(project.copyright_holder)}   # name on the LICENSE copyright line; seeded from the git owner

${yamlBlock('audiences', config.audiences)}

${yamlBlock('use_cases', config.use_cases)}   # 3-7 concrete jobs this project does

keywords:
${yamlBlock('github_topics', keywords.github_topics, '  ')}   # 8-20 terms, lowercase with hyphens
${yamlBlock('npm_keywords', keywords.npm_keywords, '  ')}   # 5-15 terms for package.json keywords

links:
  homepage:${yamlScalar(links.homepage)}
  docs:${yamlScalar(links.docs)}
  demo:${yamlScalar(links.demo)}
  issues:${yamlScalar(links.issues)}

quickstart:
${yamlBlock('prerequisites', quickstart.prerequisites, '  ')}
  install:${yamlScalar(quickstart.install)}
  run:${yamlScalar(quickstart.run)}
  test:${yamlScalar(quickstart.test)}

artifacts:
  has_npm_package: ${artifacts.has_npm_package ? 'true' : 'false'}
  has_docs_site: ${artifacts.has_docs_site ? 'true' : 'false'}
  npm_published: ${artifacts.npm_published ? 'true' : 'false'}   # flip to true once the package actually lands on the npm registry

${yamlBlock('differentiators', config.differentiators)}   # "why this repo, not the alternatives"

safety:
  allow_autofix: ${safety.allow_autofix ? 'true' : 'false'}          # lets the Action open autofix PRs
  require_ack_for_publish: ${safety.require_ack_for_publish === false ? 'false' : 'true'}
  ack:${yamlScalar(safety.ack)}   # optional override of the github-sync ACK string; empty keeps the default
`;
}

export function renderReadme(config, pkg, options = {}) {
  const project = config.project || {};
  const name = project.name || (pkg && pkg.name) || 'project';
  const oneLiner = project.one_liner || project.description || 'One-line description goes here.';
  const quickstart = config.quickstart || {};
  const { install, run, test } = deriveQuickstartCommands(config, pkg);
  const prerequisites = Array.isArray(quickstart.prerequisites) ? quickstart.prerequisites : [];

  const lines = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(oneLiner);
  lines.push('');
  if (install || run || test) {
    lines.push('## Quickstart');
    lines.push('');
    if (prerequisites.length > 0) {
      lines.push(`**Prerequisites:** ${prerequisites.join(', ')}`);
      lines.push('');
    }
    if (install || run) {
      lines.push('```bash');
      if (install) lines.push(install);
      if (run) lines.push(run);
      lines.push('```');
      lines.push('');
    }
    if (test) {
      lines.push('Run the tests:');
      lines.push('');
      lines.push('```bash');
      lines.push(test);
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('## Who is it for');
  lines.push('');
  if (Array.isArray(config.audiences) && config.audiences.length > 0) {
    for (const audience of config.audiences) lines.push(`- ${audience}`);
  } else {
    lines.push('<!-- TODO: describe the primary audiences (1-3 bullets) -->');
  }
  lines.push('');
  lines.push('## Use cases');
  lines.push('');
  if (Array.isArray(config.use_cases) && config.use_cases.length > 0) {
    for (const useCase of config.use_cases) lines.push(`- ${useCase}`);
  } else {
    lines.push('<!-- TODO: list 3-7 concrete use cases -->');
  }
  lines.push('');
  lines.push('## Examples');
  lines.push('');
  lines.push('<!-- TODO: add 2-5 short, runnable examples -->');
  lines.push('');
  if (run) {
    lines.push('```bash');
    lines.push(`${run} --help`);
    lines.push('```');
    lines.push('');
  }
  lines.push('## Why choose this');
  lines.push('');
  if (Array.isArray(config.differentiators) && config.differentiators.length > 0) {
    for (const differentiator of config.differentiators) lines.push(`- ${differentiator}`);
  } else {
    lines.push('<!-- TODO: list 2-4 differentiators with numbers and sources where possible -->');
  }
  lines.push('');
  lines.push('## Status');
  lines.push('');
  if (config.links && config.links.issues) {
    lines.push(`Actively maintained. See [issues](${config.links.issues}) for the current roadmap and known gaps.`);
  } else {
    lines.push('Actively maintained. TODO: link the issue tracker so readers can follow the roadmap.');
  }
  lines.push('');
  if (options.footer !== false) {
    lines.push('## License');
    lines.push('');
    lines.push('MIT');
    lines.push('');
  }
  return lines.join('\n');
}

export function renderAgentsMd(config, pkg) {
  const project = config.project || {};
  const quickstart = config.quickstart || {};
  const { test } = deriveQuickstartCommands(config, pkg);
  const lint = commandFor(pkg, ['lint', 'format'], null);
  const build = commandFor(pkg, ['build', 'compile'], null);

  const lines = [];
  lines.push('# AGENTS.md');
  lines.push('');
  lines.push('> Operational instructions for coding agents (Codex, Cursor, OpenCode, Claude Code).');
  lines.push('>');
  lines.push('> ⚠️ DRAFT GENERATED BY `rdk` — review every command by hand before relying on it.');
  lines.push('> Research shows fully LLM-generated AGENTS.md files reduce task success; treat this as a starting point only.');
  lines.push('');
  const agentsName = project.name || (pkg && pkg.name) || 'unknown';
  const agentsTagline = project.one_liner || project.description || '';
  lines.push(agentsTagline ? `Project: ${agentsName} — ${agentsTagline}` : `Project: ${agentsName}`);
  lines.push('');
  lines.push('## Commands');
  lines.push('');
  const commandGroups = [];
  if (test) commandGroups.push(['# run the test suite', test]);
  if (lint) commandGroups.push(['# lint / format', lint]);
  if (build) commandGroups.push(['# build', build]);
  if (quickstart.install) commandGroups.push(['# install dependencies', quickstart.install]);
  if (commandGroups.length > 0) {
    lines.push('```bash');
    commandGroups.forEach(([comment, command], index) => {
      if (index > 0) lines.push('');
      lines.push(comment);
      lines.push(command);
    });
    lines.push('```');
  }
  lines.push('');
  lines.push('## Repository map');
  lines.push('');
  lines.push('| Path | Purpose |');
  lines.push('| --- | --- |');
  lines.push('| `.discoverability/project.yml` | source of truth for repo metadata |');
  lines.push('| `packages/` | publishable packages |');
  lines.push('| `docs/` | documentation sources |');
  lines.push('');
  lines.push('## Distribution');
  lines.push('');
  lines.push('- `rdk channels` lists where to publish: mechanism, applicability, next action (read-only).');
  lines.push('- `rdk track` is the campaign dashboard over `.discoverability/submissions.json`; `--json` prints the canonical status object (schema `rdk-distribution/1`).');
  lines.push('- `rdk track --adopt` pulls pre-ledger rdk/* PRs into the ledger; `--sync` rewrites recorded statuses from live probes; `--mark <target> --status <status>` overrides one row.');
  lines.push("- **Don't** write the ledger without the guard chain `--apply --ack <ACK> --reason \"<why>\" --plan-digest <DIGEST>`; the digest binds the write to the approved dry-run preview.");
  lines.push("- **Don't** hand-edit `.discoverability/submissions.json` to match a probe; run `rdk track --sync` under the guard.");
  lines.push('');
  lines.push("## Do / Don't");
  lines.push('');
  lines.push('- **Do** run the test suite before committing.');
  lines.push('- **Do** keep `.discoverability/project.yml` in sync with `package.json`.');
  lines.push("- **Don't** bump versions, create tags, publish, force-push or delete files without explicit human confirmation.");
  lines.push("- **Don't** rewrite unrelated files while fixing a specific finding.");
  lines.push('');
  return lines.join('\n');
}

export function renderLlmsTxt(config, pkg, readmeText) {
  const project = config.project || {};
  const name = project.name || (pkg && pkg.name) || 'project';
  const summary = project.one_liner || project.description || 'See the README for details.';
  const links = config.links || {};
  const lines = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(`> ${summary}`);
  lines.push('');
  if (project.description && project.description !== summary) {
    lines.push(project.description);
    lines.push('');
  }
  lines.push('This file follows the llms.txt convention: a short, LLM-friendly index of the project.');
  lines.push('');
  lines.push('## Docs');
  lines.push('');
  const docLinks = [
    links.docs && ['Documentation', links.docs],
    links.homepage && ['Homepage', links.homepage],
    links.demo && ['Demo', links.demo],
    links.issues && ['Issues', links.issues],
  ].filter(Boolean);
  if (docLinks.length === 0) {
    lines.push('- [README.md](./README.md): installation, usage and examples');
  } else {
    const descriptions = { Documentation: 'setup, configuration and scoring reference', Homepage: 'project landing page', Demo: 'before/after example repository', Issues: 'roadmap and known gaps' };
    for (const [label, url] of docLinks) lines.push(`- [${label}](${url}): ${descriptions[label] || label}`);
    lines.push('- [README.md](./README.md): install, run and test instructions');
  }
  lines.push('');
  const quickstart = config.quickstart || {};
  const facts = [];
  if (quickstart.install) facts.push(`- Install: \`${quickstart.install}\``);
  if (quickstart.run) facts.push(`- Run: \`${quickstart.run}\``);
  if (quickstart.test) facts.push(`- Test: \`${quickstart.test}\``);
  if (Array.isArray(config.use_cases) && config.use_cases.length > 0) {
    // No slice here: silently dropping a configured use case from an
    // AI-facing index is exactly the kind of drift this tool exists to prevent.
    facts.push(`- Use cases: ${config.use_cases.join('; ')}`);
  }
  if (facts.length > 0) {
    lines.push('## Key facts');
    lines.push('');
    lines.push(...facts);
    lines.push('');
  }
  lines.push('## Distribution tracking');
  lines.push('');
  lines.push('- Ledger: `.discoverability/submissions.json`, committed campaign state with schema `rdk-distribution/1`.');
  lines.push('- `rdk track` prints the live status (`--json` for the canonical object); `--adopt` pulls pre-ledger rdk/* PRs in, `--sync` rewrites recorded statuses from live probes, `--mark <target> --status <status>` overrides one row.');
  lines.push('- Every ledger write requires the guard chain `--apply --ack <ACK> --reason "<why>" --plan-digest <DIGEST>` (the digest of the dry-run preview).');
  lines.push('- Non-PR channels report live presence by probe: `crawl`, `http-search` and `registry-read`; PR channels report state via `gh`.');
  lines.push('');
  lines.push('## Optional');
  lines.push('');
  lines.push('- [llms-full.txt](./llms-full.txt): the full documentation in a single file');
  lines.push('- [AGENTS.md](./AGENTS.md): instructions for coding agents');
  lines.push('');
  return lines.join('\n');
}

export function renderLlmsFullTxt(config, pkg, readmeText, extraDocs = []) {
  const project = config.project || {};
  const name = project.name || (pkg && pkg.name) || 'project';
  const parts = [];
  parts.push(`# ${name} — full documentation`);
  parts.push('');
  parts.push(`> ${project.one_liner || project.description || ''}`);
  parts.push('');
  parts.push('This is the concatenated documentation intended for LLM grounding. Regenerate with `rdk fix`.');
  parts.push('');
  if (readmeText) {
    parts.push('---');
    parts.push('');
    parts.push('# README');
    parts.push('');
    // a CRLF README must not leak \r\n into the LF body: mergeGenerated would double it
    parts.push(String(readmeText).trim().replace(/\r\n/g, '\n'));
    parts.push('');
  }
  for (const doc of extraDocs) {
    parts.push('---');
    parts.push('');
    parts.push(`# ${doc.title}`);
    parts.push('');
    parts.push(String(doc.content).trim());
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Canonical repository URL: package.json repository first, else a GitHub-style
 * issues link with the tracker suffix stripped. A bare tracker URL (Jira,
 * Bugzilla) is never a repository and must not reach package.json or schema.org.
 */
export function repositoryUrl(config, pkg) {
  const repo = pkg && pkg.repository;
  const raw = typeof repo === 'string' ? repo : repo && repo.url;
  if (raw) return normalizeRepoUrl(raw);
  const gh = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/issues\/?$/.exec(String((config && config.links && config.links.issues) || ''));
  return gh ? `https://github.com/${gh[1]}/${gh[2]}` : null;
}

function normalizeRepoUrl(url) {
  const value = String(url).trim().replace(/^git\+/, '').replace(/\.git$/, '');
  const ssh = /^(?:git@|ssh:\/\/git@)([^:/]+)[:/](.+)$/.exec(value);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return value;
}

/** Version the generated metadata should carry: config override, then package, then the stub default. */
export function expectedVersion(config, pkg) {
  return String((config && config.version) || (pkg && pkg.version) || '0.1.0');
}

/** Author for the citation stub: configured holder, package author, repository owner, else an explicit TODO. */
function citationAuthor(config, pkg, cwd) {
  const holder = config && config.project && config.project.copyright_holder;
  if (holder && String(holder).trim() !== '') return String(holder).trim();
  const author = pkg && pkg.author;
  if (typeof author === 'string' && author.trim() !== '') return author.trim();
  if (author && typeof author === 'object' && typeof author.name === 'string' && author.name.trim() !== '') return author.name.trim();
  const owner = cwd ? repoOwnerStrict(cwd) : null;
  return owner || 'TODO: maintainer name';
}

const CITATION_VERSION_RE = /^version:[ \t]*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s#]+)/m;
const CITATION_REPOSITORY_RE = /^repository-code:[ \t]*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s#]*)/m;

function unquoteYamlScalar(raw) {
  const value = String(raw).trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Surgical CITATION.cff version drift. Non-null only when the file carries a
 * `version:` key whose value differs from the expected one, so hand-written
 * citation files without the key are never touched. `refreshed` replaces just
 * the scalar, preserving every other line and any trailing inline comment.
 */
export function citationVersionDrift(cwd, config, pkg) {
  const path = join(cwd, 'CITATION.cff');
  const text = readTextIfExists(path);
  if (text === null) return null;
  const match = CITATION_VERSION_RE.exec(text);
  if (!match) return null;
  const current = unquoteYamlScalar(match[1]);
  const expected = expectedVersion(config, pkg);
  if (current === expected) return null;
  return { path, current, expected, refreshed: text.replace(CITATION_VERSION_RE, `version: ${JSON.stringify(expected)}`) };
}

/** Fills a present-but-empty repository-code scalar; an absent or filled key is never touched and no derivable URL means nothing to fill. */
export function citationRepositoryRefresh(text, url) {
  if (!url) return null;
  const value = String(text);
  const match = CITATION_REPOSITORY_RE.exec(value);
  if (match === null) return null;
  if (unquoteYamlScalar(match[1]).trim() !== '') return null;
  return value.replace(CITATION_REPOSITORY_RE, `repository-code: ${JSON.stringify(url)}`);
}

/** Disk-backed repository-code drift: feeds the citation patch applicability and the hygiene audit. */
export function citationRepositoryDrift(cwd, config, pkg) {
  const path = join(cwd, 'CITATION.cff');
  const text = readTextIfExists(path);
  if (text === null) return null;
  const expected = repositoryUrl(config, pkg);
  const refreshed = citationRepositoryRefresh(text, expected);
  if (refreshed === null) return null;
  return { path, current: '', expected, refreshed };
}

/**
 * Surgical docs/jsonld.jsonld drift: refreshes only an existing
 * `softwareVersion` key and never adds one to a hand-written snippet.
 */
export function jsonldVersionDrift(cwd, pkg) {
  if (!pkg || !pkg.version) return null;
  const path = join(cwd, 'docs', 'jsonld.jsonld');
  const text = readTextIfExists(path);
  if (text === null) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, 'softwareVersion')) return null;
  if (String(data.softwareVersion) === String(pkg.version)) return null;
  return { path, data, current: String(data.softwareVersion), expected: String(pkg.version) };
}

export function renderCitationCff(config, pkg, cwd = null) {
  const project = config.project || {};
  const message = 'CITATION.cff — generated by rdk. Verify authors, version and license before release.';
  const licenseSpdx = detectLicenseSpdx(cwd);
  return `cff-version: 1.2.0
message: "${message}"
title: ${JSON.stringify(project.name || '')}
version: ${JSON.stringify(expectedVersion(config, pkg))}
${licenseSpdx ? `license: ${licenseSpdx}\n` : ''}type: software
authors:
  - name: ${JSON.stringify(citationAuthor(config, pkg, cwd))}
    # orcid / affiliation optional
repository-code: ${JSON.stringify(repositoryUrl(config, pkg) || '')}
abstract: ${JSON.stringify(project.description || project.one_liner || '')}
${yamlBlock('keywords', (config.keywords && config.keywords.npm_keywords) || [])}
`;
}

const MANIFEST_LANGUAGES = [
  ['package.json', 'JavaScript'],
  ['tsconfig.json', 'TypeScript'],
  ['pyproject.toml', 'Python'],
  ['setup.py', 'Python'],
  ['go.mod', 'Go'],
  ['Cargo.toml', 'Rust'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java'],
  ['build.gradle.kts', 'Kotlin'],
  ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'],
  ['pubspec.yaml', 'Dart'],
  ['mix.exs', 'Elixir'],
  ['Package.swift', 'Swift'],
  ['build.sbt', 'Scala'],
  ['DESCRIPTION', 'R'],
  ['stack.yaml', 'Haskell'],
  ['cpanfile', 'Perl'],
  ['CMakeLists.txt', 'C++'],
];

const EXTENSION_LANGUAGES = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.vue': 'JavaScript', '.svelte': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.py': 'Python', '.pyi': 'Python',
  '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP',
  '.cs': 'C#', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.c': 'C', '.h': 'C',
  '.swift': 'Swift', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.hs': 'Haskell',
  '.scala': 'Scala', '.clj': 'Clojure', '.lua': 'Lua', '.pl': 'Perl', '.pm': 'Perl', '.r': 'R',
  '.sh': 'Shell', '.sql': 'SQL', '.zig': 'Zig', '.ml': 'OCaml', '.fs': 'F#', '.groovy': 'Groovy', '.tf': 'HCL',
};

const LICENSE_SPDX_DETECTORS = [
  [/apache\s+license/i, /version\s+2/i, 'Apache-2.0'],
  [/bsd\s+3[-\s]clause/i, /redistribution/i, 'BSD-3-Clause'],
  [/bsd\s+2[-\s]clause/i, /redistribution/i, 'BSD-2-Clause'],
  [/^MIT(\s|$)/im, /permission is hereby granted/i, 'MIT'],
  [/^ISC(\s|$)/im, /permission to use, copy, modify/i, 'ISC'],
  [/mozilla\s+public\s+license/i, /2\.0/i, 'MPL-2.0'],
  [/GNU\s+AFFERO\s+GENERAL\s+PUBLIC\s+LICENSE/i, /Version\s+3/i, 'AGPL-3.0-only'],
  [/GNU\s+GENERAL\s+PUBLIC\s+LICENSE/i, /Version\s+3/i, 'GPL-3.0-only'],
  [/GNU\s+GENERAL\s+PUBLIC\s+LICENSE/i, /Version\s+2/i, 'GPL-2.0-only'],
];

// the generator must not claim a license it cannot see: SPDX from the LICENSE file, or nothing
function detectLicenseSpdx(cwd) {
  if (!cwd) return null;
  const candidates = [join(cwd, 'LICENSE'), join(cwd, 'LICENSE.md'), join(cwd, 'LICENSE.txt'), join(cwd, 'COPYING'), join(cwd, '.github', 'LICENSE'), join(cwd, 'docs', 'LICENSE')];
  let text = null;
  for (const path of candidates) {
    const value = readTextIfExists(path);
    if (value !== null) {
      text = value;
      break;
    }
  }
  if (text === null) return null;
  for (const [first, second, spdx] of LICENSE_SPDX_DETECTORS) {
    if (first.test(text) && second.test(text)) return spdx;
  }
  return null;
}

// no recognizable marker means no programmingLanguage: a wrong language misleads crawlers more than none
function detectLanguages(cwd, pkg) {
  const counts = new Map();
  const add = (lang, weight) => counts.set(lang, (counts.get(lang) || 0) + weight);
  if (pkg) add('JavaScript', 100);
  if (cwd) {
    for (const [file, lang] of MANIFEST_LANGUAGES) {
      if (exists(join(cwd, file))) add(lang, 100);
    }
    for (const file of listFiles(cwd, { recursive: true, maxDepth: 4 })) {
      const lang = EXTENSION_LANGUAGES[extname(file).toLowerCase()];
      if (lang) add(lang, 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lang]) => lang)
    .slice(0, 5);
}

export function renderJsonLd(config, pkg, cwd) {
  const project = config.project || {};
  const name = project.name || (pkg && pkg.name) || 'project';
  const url = config.links && (config.links.homepage || config.links.docs);
  const languages = detectLanguages(cwd, pkg);
  const nodeRuntime = languages.includes('JavaScript') || languages.includes('TypeScript');
  const licenseSpdx = detectLicenseSpdx(cwd);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name,
    description: project.description || project.one_liner || '',
    ...(languages.length > 0 ? { programmingLanguage: languages } : {}),
    ...(nodeRuntime ? { runtimePlatform: 'Node.js' } : {}),
    ...(licenseSpdx ? { license: `https://opensource.org/licenses/${licenseSpdx}` } : {}),
    keywords: ((config.keywords && config.keywords.npm_keywords) || []).join(', '),
  };
  if (url) data.url = url;
  if (pkg && pkg.version) data.softwareVersion = pkg.version;
  const repoUrl = repositoryUrl(config, pkg);
  if (repoUrl) data.codeRepository = repoUrl;
  const ownerMatch = repoUrl ? /^https?:\/\/[^/\s]+\/([^/\s]+)\/[^/\s]+/.exec(repoUrl) : null;
  const author = project.copyright_holder || (ownerMatch && ownerMatch[1]);
  if (author) data.author = author;
  const sameAs = [];
  const identityUrl = repoUrl || (config.links && config.links.homepage);
  if (identityUrl) sameAs.push(identityUrl);
  // npm sameAs claims a registry page exists: only the config's npm_published flag can honestly source that
  const npmPublished = Boolean(config.artifacts && config.artifacts.npm_published);
  if (npmPublished && pkg && pkg.name && !pkg.private) sameAs.push(`https://www.npmjs.com/package/${pkg.name}`);
  if (sameAs.length > 0) data.sameAs = sameAs;
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function renderGitattributes() {
  return `# Normalise line endings for text files
* text=auto eol=lf

# Explicitly treat binary assets as binary
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.woff binary
*.woff2 binary
*.pdf binary
`;
}

const DEPENDABOT_ECOSYSTEMS = [
  ['npm', (cwd, pkg) => Boolean(pkg) || exists(join(cwd, 'package.json'))],
  ['pip', (cwd) => ['requirements.txt', 'pyproject.toml', 'setup.py'].some((file) => exists(join(cwd, file)))],
  ['gomod', (cwd) => exists(join(cwd, 'go.mod'))],
  ['cargo', (cwd) => exists(join(cwd, 'Cargo.toml'))],
  ['maven', (cwd) => exists(join(cwd, 'pom.xml'))],
  ['gradle', (cwd) => ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((file) => exists(join(cwd, file)))],
  ['bundler', (cwd) => exists(join(cwd, 'Gemfile'))],
  ['composer', (cwd) => exists(join(cwd, 'composer.json'))],
  ['nuget', (cwd) => rootHasExtension(cwd, ['.csproj', '.fsproj', '.vbproj', '.sln'])],
  ['pub', (cwd) => exists(join(cwd, 'pubspec.yaml'))],
  ['mix', (cwd) => exists(join(cwd, 'mix.exs'))],
  ['swift', (cwd) => exists(join(cwd, 'Package.swift'))],
  ['docker', (cwd) => ['Dockerfile', 'Containerfile'].some((file) => exists(join(cwd, file)))],
  ['terraform', (cwd) => rootHasExtension(cwd, ['.tf'])],
  ['github-actions', (cwd) => exists(join(cwd, '.github', 'workflows'))],
];

function rootHasExtension(cwd, extensions) {
  let entries;
  try {
    entries = readdirSync(cwd);
  } catch {
    return false;
  }
  return entries.some((entry) => extensions.some((extension) => entry.toLowerCase().endsWith(extension)));
}

/** Package ecosystems dependabot should watch, derived from manifests present in the repository. */
export function dependabotEcosystems(cwd, pkg) {
  return DEPENDABOT_ECOSYSTEMS.filter(([, detect]) => detect(cwd, pkg)).map(([ecosystem]) => ecosystem);
}

/** dependabot config: weekly update blocks, one per detected ecosystem. */
export function renderDependabotYml(ecosystems) {
  const blocks = ecosystems.map((ecosystem) => `  - package-ecosystem: ${ecosystem}\n    directory: "/"\n    schedule:\n      interval: weekly`);
  return `version: 2\nupdates:\n${blocks.join('\n')}\n`;
}

export function renderIssueTemplate() {
  return `---
name: Bug report
about: Report a reproducible problem
title: "bug: "
labels: bug
---

## What happened

## What you expected

## Reproduction

\`\`\`bash
# minimal commands
\`\`\`

## Environment

- OS:
- Node:
- Package version:
`;
}

export function renderFeatureTemplate() {
  return `---
name: Feature request
about: Suggest a concrete capability
title: "feat: "
labels: enhancement
---

## Problem

## Proposed solution

## Alternatives considered
`;
}

export function renderPrTemplate() {
  return `## What this changes

## Why

## How it was verified

- [ ] tests pass
- [ ] \`rdk audit\` score did not regress

## Risk / rollout
`;
}

/**
 * CODEOWNERS for the audited repository: the owner comes from its origin
 * remote, because `* @WhiteBite` in someone else's repository would silently
 * assign their code to us.
 */
export function renderCodeowners(cwd = process.cwd(), owner = repoOwnerStrict(cwd)) {
  if (!owner) return null;
  return `# Default owners for everything\n* @${owner}\n`;
}


export function renderLicense(holder = 'the authors', year = new Date().getFullYear()) {
  return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

export function renderSecurityMd(projectName = 'this project') {
  return `# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| latest | yes |

## Reporting a vulnerability

Please report security issues privately: open a private security advisory on
GitHub (Security -> Report a vulnerability) or email the maintainers.

Do not open a public issue for an unreported vulnerability.

## Scope

TODO: state what ${projectName} runs (local-only or server-side), what data it
touches, and whether it sends telemetry, so reporters know what is in scope.
Reports about dependency vulnerabilities are welcome and are treated as high
priority.
`;
}

export function renderContributingMd(projectName = 'this project') {
  return `# Contributing to ${projectName}

Thanks for taking the time to contribute.

## Development setup

1. Fork and clone the repository.
2. Install dependencies (\`npm install\`).
3. Run the tests (\`npm test\`).
4. Create a branch, make your change, add or update tests.
5. Open a pull request describing the problem and the fix.

## Ground rules

- Keep pull requests small and focused.
- Run \`npm test\` before pushing.
- Only run a discoverability audit (\`npx repo-aeo audit\`) when a maintainer explicitly asks for one.
- Never publish, tag or force-push on behalf of the maintainers.

## Code of conduct

Be respectful. Maintainers may close issues that do not follow this guide.
`;
}

/** CODE_OF_CONDUCT.md: Contributor Covenant 2.1 with the same private reporting channel as the SECURITY.md stub. */
export function renderCodeOfConduct() {
  return `# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming,
diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment for our
community include:

- Demonstrating empathy and kindness toward other people
- Being respectful of differing opinions, viewpoints, and experiences
- Giving and gracefully accepting constructive feedback
- Accepting responsibility and apologizing to those affected by our mistakes,
  and learning from the experience
- Focusing on what is best not just for us as individuals, but for the overall
  community

Examples of unacceptable behavior include:

- The use of sexualized language or imagery, and sexual attention or advances of
  any kind
- Trolling, insulting or derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information, such as a physical or email address,
  without their explicit permission
- Other conduct which could reasonably be considered inappropriate in a
  professional setting

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards of
acceptable behavior and will take appropriate and fair corrective action in
response to any behavior that they deem inappropriate, threatening, offensive,
or harmful.

Community leaders have the right and responsibility to remove, edit, or reject
comments, commits, code, wiki edits, issues, and other contributions that are
not aligned to this Code of Conduct, and will communicate reasons for moderation
decisions when appropriate.

## Scope

This Code of Conduct applies within all community spaces, and also applies when
an individual is officially representing the community in public spaces.
Examples of representing our community include using an official email address,
posting via an official social media account, or acting as an appointed
representative at an online or offline event.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the community leaders responsible for enforcement by opening a
private security advisory on GitHub (Security -> Report a vulnerability) or
emailing the maintainers.
All complaints will be reviewed and investigated promptly and fairly.

All community leaders are obligated to respect the privacy and security of the
reporter of any incident.

## Enforcement Guidelines

Community leaders will follow these Community Impact Guidelines in determining
the consequences for any action they deem in violation of this Code of Conduct:

### 1. Correction

**Community Impact**: Use of inappropriate language or other behavior deemed
unprofessional or unwelcome in the community.

**Consequence**: A private, written warning from community leaders, providing
clarity around the nature of the violation and an explanation of why the
behavior was inappropriate. A public apology may be requested.

### 2. Warning

**Community Impact**: A violation through a single incident or series of
actions.

**Consequence**: A warning with consequences for continued behavior. No
interaction with the people involved, including unsolicited interaction with
those enforcing the Code of Conduct, for a specified period of time. This
includes avoiding interactions in community spaces as well as external channels
like social media. Violating these terms may lead to a temporary or permanent
ban.

### 3. Temporary Ban

**Community Impact**: A serious violation of community standards, including
sustained inappropriate behavior.

**Consequence**: A temporary ban from any sort of interaction or public
communication with the community for a specified period of time. No public or
private interaction with the people involved, including unsolicited interaction
with those enforcing the Code of Conduct, is allowed during this period.
Violating these terms may lead to a permanent ban.

### 4. Permanent Ban

**Community Impact**: Demonstrating a pattern of violation of community
standards, including sustained inappropriate behavior, harassment of an
individual, or aggression toward or disparagement of classes of individuals.

**Consequence**: A permanent ban from any sort of public interaction within the
community.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant][homepage],
version 2.1, available at
[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html][v2.1].

Community Impact Guidelines were inspired by
[Mozilla's code of conduct enforcement ladder][Mozilla CoC].

For answers to common questions about this code of conduct, see the FAQ at
[https://www.contributor-covenant.org/faq][FAQ]. Translations are available at
[https://www.contributor-covenant.org/translations][translations].

[homepage]: https://www.contributor-covenant.org
[v2.1]: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html
[Mozilla CoC]: https://github.com/mozilla-community-health/tooling/blob/main/code-of-conduct/Code_of_Conduct.md
[FAQ]: https://www.contributor-covenant.org/faq
[translations]: https://www.contributor-covenant.org/translations
`;
}
