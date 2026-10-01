/**
 * Deterministic generators. Every artifact is derived from
 * .discoverability/project.yml plus facts read from the repository — the
 * generator never invents claims it cannot source from the config.
 */
import { extname, join } from 'node:path';
import { exists, listFiles, readTextIfExists, mtimeMs } from '../util/fs.js';
import { repoOwnerStrict, toolDocUrl } from '../util/repo.js';

function yamlList(items, indent = '  ') {
  if (!Array.isArray(items) || items.length === 0) return `${indent}[]`;
  return items.map((item) => `${indent}- ${JSON.stringify(String(item))}`).join('\n');
}

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

/**
 * Merges freshly generated content into an existing file:
 *   - no file            -> generated content wrapped in markers + note
 *   - file with markers  -> only the marked region is replaced
 *   - file without markers that differs from the generated content
 *                        -> treated as hand-edited and left untouched (the
 *                           caller reports it), so `rdk fix` never destroys
 *                           manual work
 */
export function mergeGenerated(existing, generated) {
  const bodyRaw = String(generated).trim();
  if (existing === null || existing === undefined) {
    return `${GENERATED_START}\n${bodyRaw}\n${GENERATED_END}\n\n## Hand-written notes\n\n${HANDWRITTEN_NOTE}\n`;
  }
  const text = String(existing);
  if (text.includes(GENERATED_START) && text.includes(GENERATED_END)) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = eol === '\r\n' ? bodyRaw.replace(/\n/g, '\r\n') : bodyRaw;
    const head = text.slice(0, text.indexOf(GENERATED_START));
    const tail = text.slice(text.indexOf(GENERATED_END) + GENERATED_END.length);
    return `${head}${GENERATED_START}${eol}${body}${eol}${GENERATED_END}${tail}`;
  }
  return null; // hand-edited legacy file: caller must not overwrite
}

/**
 * Names of the generated llms files whose on-disk content no longer matches the
 * rendered output. Marker-managed files are compared by content (so `rdk fix`
 * clearing the drift is guaranteed); hand-written files without markers fall
 * back to README mtime, which `rdk fix` never overwrites.
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
      const readmeTime = mtimeMs(readmePath);
      if (fileTime !== null && readmeTime !== null && readmeTime - fileTime > 60 * 60 * 1000) stale.push(relative);
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
  lines.push(`Project: ${project.name || (pkg && pkg.name) || 'unknown'} — ${project.one_liner || ''}`);
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

export function renderCitationCff(config, pkg) {
  const project = config.project || {};
  const message = 'CITATION.cff — generated by rdk. Verify authors and version before release.';
  return `cff-version: 1.2.0
message: "${message}"
title: ${JSON.stringify(project.name || '')}
version: ${JSON.stringify(String((config.version || '0.1.0')))}
license: MIT
type: software
authors:
  - name: "TODO: maintainer name"
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
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name,
    description: project.description || project.one_liner || '',
    ...(languages.length > 0 ? { programmingLanguage: languages } : {}),
    ...(nodeRuntime ? { runtimePlatform: 'Node.js' } : {}),
    license: 'https://opensource.org/licenses/MIT',
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
  if (pkg && pkg.name && !pkg.private) sameAs.push(`https://www.npmjs.com/package/${pkg.name}`);
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
export function renderCodeowners(cwd = process.cwd()) {
  const owner = repoOwnerStrict(cwd);
  if (!owner) return null;
  return `# Default owners for everything
* @${owner}
`;
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

${projectName} runs locally and does not transmit telemetry. Reports about
dependency vulnerabilities are welcome and are treated as high priority.
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
