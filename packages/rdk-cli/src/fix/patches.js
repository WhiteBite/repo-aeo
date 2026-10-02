/**
 * Safe autofix patches. Every patch is:
 *   - idempotent (running `rdk fix` twice changes nothing the second time)
 *   - additive or normalising (no deletion of user content)
 *   - reversible through git (the Action commits to a dedicated branch)
 *
 * Patches never publish, tag, bump versions or force-push.
 */
import { dirname, join } from 'node:path';
import { exists, readTextIfExists, writeText } from '../util/fs.js';
import { parseMarkdown, slugifyTopic, uniq, normalizeHeading } from '../audit/checks/_shared.js';
import {
  renderProjectYml,
  renderReadme,
  renderAgentsMd,
  renderLlmsTxt,
  renderLlmsFullTxt,
  renderCitationCff,
  renderJsonLd,
  renderGitattributes,
  renderIssueTemplate,
  renderFeatureTemplate,
  renderPrTemplate,
  renderCodeowners,
  renderLicense,
  renderSecurityMd,
  renderContributingMd,
  renderCodeOfConduct,
  citationVersionDrift,
  jsonldVersionDrift,
  dependabotEcosystems,
  renderDependabotYml,
  mergeGenerated,
  repositoryUrl,
  deriveQuickstartCommands,
} from '../generate/index.js';

const GITIGNORE_DEFAULTS = ['node_modules/', 'dist/', 'build/', '*.log', '.DS_Store', '.env'];

function mutation(path, before, after) {
  return { path, before, after, created: before === null };
}

/** Rewrites a `key:` block (inline or list form) inside YAML text, preserving comments and EOL style. */
function replaceYamlList(text, key, values) {
  const eol = dominantEol(String(text));
  const lines = String(text).split('\n');
  const keyRe = new RegExp(`^(\\s*)${key}\\s*:(.*)$`);
  const index = lines.findIndex((line) => keyRe.test(line.replace(/\r$/, '')));
  if (index === -1) return { text, changed: false };
  const match = lines[index].replace(/\r$/, '').match(keyRe);
  const indent = match[1];
  const inline = match[2].trim();
  if (inline.startsWith('#')) {
    // key with only a comment on the same line: keep the comment, add the list below
    const rendered = values.map((value) => `${indent}  - ${JSON.stringify(value)}`).join(eol);
    lines.splice(index, 1, `${indent}${key}: ${inline}${eol}${rendered}`);
    return { text: lines.join('\n'), changed: true };
  }
  let comment = '';
  if (/^[[{]/.test(inline)) {
    const close = Math.max(inline.lastIndexOf(']'), inline.lastIndexOf('}'));
    const tail = inline.slice(close + 1).trim();
    if (tail.startsWith('#')) comment = ` ${tail}`;
  }
  let end = index + 1;
  while (end < lines.length) {
    const probe = lines[end].replace(/\r$/, '');
    if (probe.trim() === '') {
      end += 1;
      continue;
    }
    const lineIndent = probe.length - probe.trimStart().length;
    if (lineIndent <= indent.length || !probe.trim().startsWith('-')) break;
    end += 1;
  }
  const rendered = values.length === 0
    ? `${indent}${key}: []${comment}`
    : `${indent}${key}:${comment}${eol}${values.map((value) => `${indent}  - ${JSON.stringify(value)}`).join(eol)}`;
  lines.splice(index, end - index, rendered);
  return { text: lines.join('\n'), changed: true };
}

/** Reads the package that would actually be published (root or workspace). */
function readPackageJson(ctx) {
  const path = (ctx.publishable && ctx.publishable.path) || join(ctx.cwd, 'package.json');
  if (!path || !exists(path)) return null;
  const text = readTextIfExists(path);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { path, text, json: null, parseError: true };
  }
  return { path, text, json, parseError: false };
}

function serializeJson(value, originalText) {
  const indentMatch = /^(\s+)"/.exec(String(originalText || ''));
  const indent = indentMatch ? indentMatch[1] : '  ';
  const eol = /\r\n/.test(String(originalText || '')) ? '\r\n' : '\n';
  return `${JSON.stringify(value, null, indent).replace(/\n/g, eol)}${eol}`;
}

// files-array entries are resolved from the publishable package directory, matching what npm pack includes
function packageDirFor(ctx) {
  return ctx.publishable && ctx.publishable.path ? dirname(ctx.publishable.path) : ctx.cwd;
}

function readmeBase(ctx) {
  const path = join(ctx.cwd, 'README.md');
  const onDisk = exists(path);
  // When the README does not exist yet, evaluate against the scaffold that
  // `readme.generate` will produce in the same run, so patches stay ordered.
  const before = onDisk ? readTextIfExists(path) : renderReadme(ctx.config, ctx.pkg);
  return { path, onDisk, before };
}

function dominantEol(text) {
  const value = String(text);
  const crlf = (value.match(/\r\n/g) || []).length;
  const lf = (value.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function withEol(text, eol) {
  return eol === '\n' ? text : text.replace(/\r?\n/g, '\r\n');
}

function h2Sections(text) {
  const sections = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    if (/^##\s/.test(line)) {
      if (current) sections.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

const EXAMPLE_SECTION_KEYS = ['examples', 'usage', 'example', 'quickstart', 'getting started'];

const EXAMPLE_STUB_MARKER = '### Example (replace with a real one)';

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// raw-text guard: a fence-desynced parseMarkdown never sees appended headings and re-appends them every pass
function rawHasHeading(text, heading) {
  return new RegExp(`^#{1,6}[ \\t]+${escapeRegExp(heading)}[ \\t]*$`, 'im').test(String(text));
}

/** Returns the body of the section that should hold examples. */
function exampleSectionBody(doc) {
  const key = EXAMPLE_SECTION_KEYS.find((candidate) => doc.sections.has(candidate));
  return key ? doc.sections.get(key).body : '';
}

const REQUIRED_README_SECTIONS = [
  { key: 'who is it for', heading: 'Who is it for' },
  { key: 'use cases', heading: 'Use cases' },
  { key: 'why choose this', heading: 'Why choose this' },
];

export const PATCHES = [
  {
    id: 'project.topics_normalize',
    title: 'Normalise GitHub topics to canonical form',
    description: 'Lowercase, hyphenate and de-duplicate keywords.github_topics in .discoverability/project.yml.',
    risk: 'safe',
    applies(ctx) {
      const path = join(ctx.cwd, '.discoverability', 'project.yml');
      if (!exists(path)) return false;
      const text = readTextIfExists(path);
      const topics = (ctx.config.keywords && ctx.config.keywords.github_topics) || [];
      const normalized = uniq(topics.map(slugifyTopic).filter(Boolean));
      return JSON.stringify(normalized) !== JSON.stringify(topics) && topics.length > 0;
    },
    mutations(ctx) {
      const path = join(ctx.cwd, '.discoverability', 'project.yml');
      const before = readTextIfExists(path);
      const topics = (ctx.config.keywords && ctx.config.keywords.github_topics) || [];
      const normalized = uniq(topics.map(slugifyTopic).filter(Boolean));
      const { text, changed } = replaceYamlList(before, 'github_topics', normalized);
      if (!changed) return [];
      return [mutation(path, before, text)];
    },
  },

  {
    id: 'project.create',
    title: 'Create .discoverability/project.yml',
    description: 'Writes the config source of truth, seeded from package.json and git remote.',
    risk: 'safe',
    applies(ctx) {
      return !ctx.configExists;
    },
    mutations(ctx) {
      const path = join(ctx.cwd, '.discoverability', 'project.yml');
      const before = exists(path) ? readTextIfExists(path) : null;
      return [mutation(path, before, renderProjectYml(ctx.config))];
    },
  },

  {
    id: 'readme.generate',
    title: 'Generate README.md from the config',
    description: 'Creates the README scaffold; a README under 200 chars (the readme.exists threshold) keeps every hand-written line and gets the missing scaffold sections appended.',
    risk: 'safe',
    applies(ctx) {
      const path = join(ctx.cwd, 'README.md');
      if (!exists(path)) return true;
      return readTextIfExists(path).trim().length < 200;
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'README.md');
      const before = exists(path) ? readTextIfExists(path) : null;
      if (before === null) return [mutation(path, null, renderReadme(ctx.config, ctx.pkg))];
      const existing = parseMarkdown(before);
      const additions = [];
      for (const sectionLines of h2Sections(renderReadme(ctx.config, ctx.pkg))) {
        const heading = /^##\s+(.*?)\s*$/.exec(sectionLines[0])[1];
        if (existing.sections.has(normalizeHeading(heading))) continue;
        additions.push(sectionLines.join('\n').replace(/\s*$/, ''));
      }
      if (additions.length === 0) return [];
      const eol = dominantEol(before);
      const after = `${before.replace(/\s*$/, '')}${eol}${eol}${withEol(additions.join('\n\n'), eol)}${eol}`;
      return [mutation(path, before, after)];
    },
  },

  {
    id: 'readme.sections_stub',
    title: 'Insert missing README sections',
    description: 'Appends stubs for Who is it for / Use cases / Why choose this when absent.',
    risk: 'safe',
    applies(ctx) {
      const { before } = readmeBase(ctx);
      const doc = parseMarkdown(before);
      return REQUIRED_README_SECTIONS.some((section) => !doc.sections.has(section.key) && !rawHasHeading(before, section.heading));
    },
    mutations(ctx) {
      const { path, before } = readmeBase(ctx);
      const doc = parseMarkdown(before);
      const additions = [];
      for (const section of REQUIRED_README_SECTIONS) {
        if (doc.sections.has(section.key) || rawHasHeading(before, section.heading)) continue;
        if (section.key === 'who is it for') {
          additions.push(`## ${section.heading}`, '', (ctx.config.audiences || []).map((a) => `- ${a}`).join('\n') || '<!-- TODO: who is this for? -->', '');
        }
        if (section.key === 'use cases') {
          additions.push(`## ${section.heading}`, '', (ctx.config.use_cases || []).map((u) => `- ${u}`).join('\n') || '<!-- TODO: 3-7 concrete use cases -->', '');
        }
        if (section.key === 'why choose this') {
          additions.push(`## ${section.heading}`, '', (ctx.config.differentiators || []).map((d) => `- ${d}`).join('\n') || '<!-- TODO: 2-4 differentiators, with numbers -->', '');
        }
      }
      if (additions.length === 0) return [];
      const eol = dominantEol(before);
      const after = `${before.replace(/\s*$/, '')}${eol}${eol}${withEol(additions.join('\n').trim(), eol)}${eol}`;
      return [mutation(path, before, after)];
    },
  },

  {
    id: 'readme.quickstart_stub',
    title: 'Add a Quickstart section with install/run/test',
    description: 'Inserts a copy-pasteable Quickstart near the top of the README.',
    risk: 'safe',
    applies(ctx) {
      const path = join(ctx.cwd, 'README.md');
      if (!exists(path)) return false;
      const text = readTextIfExists(path);
      const doc = parseMarkdown(text);
      if (doc.sections.has('quickstart') || doc.sections.has('getting started')) return false;
      if (rawHasHeading(text, 'Quickstart') || rawHasHeading(text, 'Getting started')) return false;
      const quickstart = ctx.config.quickstart || {};
      return Boolean(quickstart.install && quickstart.run);
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'README.md');
      const before = readTextIfExists(path);
      const doc = parseMarkdown(before);
      if (doc.sections.has('quickstart') || doc.sections.has('getting started')) return [];
      if (rawHasHeading(before, 'Quickstart') || rawHasHeading(before, 'Getting started')) return [];
      const eol = dominantEol(before);
      const lines = before.split(/\r?\n/);
      const quickstart = ctx.config.quickstart || {};
      const block = [
        '## Quickstart',
        '',
        '```bash',
        quickstart.install,
        quickstart.run,
        '```',
        '',
        quickstart.test ? `Tests: \`${quickstart.test}\`` : '',
        '',
      ].filter((line, index, arr) => !(line === '' && arr[index - 1] === ''));
      let insertAt = lines.findIndex((line) => /^#{1,2}\s/.test(line));
      // a first heading deep in the file would leave the stub below the 60-line fold the check measures
      if (insertAt === -1 || insertAt > 55) insertAt = 0;
      else insertAt += 1;
      lines.splice(insertAt, 0, ...block);
      return [mutation(path, before, lines.join(eol))];
    },
  },

  {
    id: 'agents.stub',
    title: 'Create a draft AGENTS.md',
    description: 'Generates AGENTS.md with commands derived from package.json scripts. Always needs human review.',
    risk: 'safe',
    applies(ctx) {
      return !exists(join(ctx.cwd, 'AGENTS.md'));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'AGENTS.md');
      const before = exists(path) ? readTextIfExists(path) : null;
      return [mutation(path, before, renderAgentsMd(ctx.config, ctx.pkg))];
    },
  },

  {
    id: 'llms.generate',
    title: 'Generate llms.txt and llms-full.txt',
    description: 'Builds the AI-facing index and full-documentation file from the config and README.',
    risk: 'safe',
    applies() {
      return true;
    },
    mutations(ctx) {
      const out = [];
      const llmsPath = join(ctx.cwd, 'llms.txt');
      const readmePath = join(ctx.cwd, 'README.md');
      // When the README does not exist yet, derive the source text from the
      // config so llms-full.txt is complete even in the same run that
      // scaffolds the README (patches are applied in registry order).
      const readme = exists(readmePath) ? readTextIfExists(readmePath) : renderReadme(ctx.config, ctx.pkg);

      const merge = (path, generated) => {
        const before = exists(path) ? readTextIfExists(path) : null;
        const after = mergeGenerated(before, generated);
        if (after === null) return null; // hand-edited, no markers: leave it alone
        if (after === before) return null; // already up to date
        return mutation(path, before, after);
      };

      const llmsChange = merge(llmsPath, renderLlmsTxt(ctx.config, ctx.pkg, readme));
      if (llmsChange) out.push(llmsChange);
      const fullChange = merge(join(ctx.cwd, 'llms-full.txt'), renderLlmsFullTxt(ctx.config, ctx.pkg, readme));
      if (fullChange) out.push(fullChange);
      return out;
    },
  },

  {
    id: 'package.metadata',
    title: 'Seed package.json metadata from the config',
    description: 'Fills description, keywords, repository, homepage and bugs when missing.',
    risk: 'safe',
    applies(ctx) {
      const pkg = readPackageJson(ctx);
      if (!pkg || pkg.parseError) return false;
      const repository = repositoryUrl(ctx.config, ctx.pkg);
      return Boolean(
        (!pkg.json.description && (ctx.config.project.one_liner || ctx.config.project.description))
        || (!Array.isArray(pkg.json.keywords) && (ctx.config.keywords.npm_keywords || []).length > 0)
        || (!pkg.json.repository && repository)
        || (!pkg.json.homepage && ctx.config.links.homepage)
        || (!pkg.json.bugs && ctx.config.links.issues),
      );
    },
    mutations(ctx) {
      const pkg = readPackageJson(ctx);
      const json = { ...pkg.json };
      const repository = repositoryUrl(ctx.config, ctx.pkg);
      if (!json.description) json.description = ctx.config.project.one_liner || ctx.config.project.description || json.description;
      if (!Array.isArray(json.keywords) && (ctx.config.keywords.npm_keywords || []).length > 0) {
        json.keywords = uniq([...(ctx.config.keywords.npm_keywords || [])]);
      }
      if (!json.repository && repository) json.repository = repository;
      if (!json.homepage && ctx.config.links.homepage) json.homepage = ctx.config.links.homepage;
      if (!json.bugs && ctx.config.links.issues) json.bugs = { url: ctx.config.links.issues };
      return [mutation(pkg.path, pkg.text, serializeJson(json, pkg.text))];
    },
  },

  {
    id: 'package.keywords',
    title: 'Top up package.json keywords from the config',
    description: 'Merges keywords.npm_keywords into package.json without dropping existing keywords.',
    risk: 'safe',
    applies(ctx) {
      const pkg = readPackageJson(ctx);
      if (!pkg || pkg.parseError) return false;
      const existing = Array.isArray(pkg.json.keywords) ? pkg.json.keywords : [];
      const wanted = (ctx.config.keywords && ctx.config.keywords.npm_keywords) || [];
      return wanted.some((keyword) => !existing.includes(keyword));
    },
    mutations(ctx) {
      const pkg = readPackageJson(ctx);
      const json = { ...pkg.json };
      const existing = Array.isArray(json.keywords) ? json.keywords : [];
      json.keywords = uniq([...existing, ...((ctx.config.keywords && ctx.config.keywords.npm_keywords) || [])]);
      return [mutation(pkg.path, pkg.text, serializeJson(json, pkg.text))];
    },
  },

  {
    id: 'package.files',
    title: 'Include discoverability artifacts in the npm tarball',
    description: 'Adds llms.txt, llms-full.txt and AGENTS.md to the files array.',
    risk: 'safe',
    applies(ctx) {
      const pkg = readPackageJson(ctx);
      if (!pkg || pkg.parseError) return false;
      if (!Array.isArray(pkg.json.files)) return false;
      const wanted = ['llms.txt', 'llms-full.txt', 'AGENTS.md'].filter((name) => exists(join(packageDirFor(ctx), name)));
      return wanted.some((name) => !pkg.json.files.includes(name));
    },
    mutations(ctx) {
      const pkg = readPackageJson(ctx);
      const json = { ...pkg.json };
      const wanted = ['llms.txt', 'llms-full.txt', 'AGENTS.md'].filter((name) => exists(join(packageDirFor(ctx), name)));
      const files = Array.isArray(json.files) ? [...json.files] : [];
      for (const name of wanted) {
        if (!files.includes(name)) files.push(name);
      }
      json.files = files;
      return [mutation(pkg.path, pkg.text, serializeJson(json, pkg.text))];
    },
  },

  {
    id: 'package.engines',
    title: 'Declare engines.node',
    description: 'Adds a conservative engines.node range when missing.',
    risk: 'safe',
    applies(ctx) {
      const pkg = readPackageJson(ctx);
      if (!pkg || pkg.parseError) return false;
      return !pkg.json.engines || !pkg.json.engines.node;
    },
    mutations(ctx) {
      const pkg = readPackageJson(ctx);
      const json = { ...pkg.json };
      json.engines = { ...(json.engines || {}), node: json.engines && json.engines.node ? json.engines.node : '>=18' };
      return [mutation(pkg.path, pkg.text, serializeJson(json, pkg.text))];
    },
  },

  {
    id: 'license.stub',
    title: 'Create a LICENSE file',
    description: 'Adds an MIT LICENSE so the project can legally be reused and recommended.',
    risk: 'safe',
    applies(ctx) {
      const names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
      const dirs = [ctx.cwd, join(ctx.cwd, '.github'), join(ctx.cwd, 'docs')];
      return !(exists(join(ctx.cwd, 'COPYING')) || dirs.some((dir) => names.some((name) => exists(join(dir, name)))));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'LICENSE');
      const holder = (ctx.config.project && ctx.config.project.copyright_holder) || 'the authors';
      return [mutation(path, null, renderLicense(holder))];
    },
  },

  {
    id: 'security.stub',
    title: 'Create SECURITY.md',
    description: 'Adds a security policy with a private reporting channel.',
    risk: 'safe',
    applies(ctx) {
      const dirs = [ctx.cwd, join(ctx.cwd, '.github'), join(ctx.cwd, 'docs')];
      return !dirs.some((dir) => exists(join(dir, 'SECURITY.md')));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'SECURITY.md');
      return [mutation(path, null, renderSecurityMd(ctx.config.project && ctx.config.project.name))];
    },
  },

  {
    id: 'contributing.stub',
    title: 'Create CONTRIBUTING.md',
    description: 'Adds contribution guidelines covering setup, tests and the PR process.',
    risk: 'safe',
    applies(ctx) {
      const dirs = [ctx.cwd, join(ctx.cwd, '.github'), join(ctx.cwd, 'docs')];
      return !dirs.some((dir) => exists(join(dir, 'CONTRIBUTING.md')));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'CONTRIBUTING.md');
      return [mutation(path, null, renderContributingMd(ctx.config.project && ctx.config.project.name))];
    },
  },

  {
    id: 'coc.stub',
    title: 'Create CODE_OF_CONDUCT.md',
    description: 'Adds the Contributor Covenant 2.1 so GitHub counts a code of conduct toward the community profile.',
    risk: 'safe',
    applies(ctx) {
      const dirs = [ctx.cwd, join(ctx.cwd, '.github'), join(ctx.cwd, 'docs')];
      return !dirs.some((dir) => exists(join(dir, 'CODE_OF_CONDUCT.md')));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'CODE_OF_CONDUCT.md');
      return [mutation(path, null, renderCodeOfConduct())];
    },
  },

  {
    id: 'readme.examples_stub',
    title: 'Add example stubs to the README',
    description: 'Inserts a runnable-looking example stub when the examples/usage section has no code block.',
    risk: 'safe',
    applies(ctx) {
      if (!deriveQuickstartCommands(ctx.config, ctx.pkg).run) return false;
      if (readmeBase(ctx).before.includes(EXAMPLE_STUB_MARKER)) return false;
      const doc = parseMarkdown(readmeBase(ctx).before);
      const body = exampleSectionBody(doc);
      const blocks = (body.match(/^(?:```|~~~)/gm) || []).length / 2;
      return blocks < 1;
    },
    mutations(ctx) {
      const { path, before } = readmeBase(ctx);
      const run = deriveQuickstartCommands(ctx.config, ctx.pkg).run;
      if (!run) return [];
      if (before.includes(EXAMPLE_STUB_MARKER)) return [];
      const doc = parseMarkdown(before);
      const sectionKey = EXAMPLE_SECTION_KEYS.find((key) => doc.sections.has(key));
      if (sectionKey) {
        const blocks = (doc.sections.get(sectionKey).body.match(/^(?:```|~~~)/gm) || []).length / 2;
        if (blocks >= 1) return [];
      }
      const eol = dominantEol(before);
      const stubLines = ['', EXAMPLE_STUB_MARKER, '', '```bash', run, '```', ''];
      let after;
      if (sectionKey) {
        // insert the stub right after the section heading
        const heading = doc.sections.get(sectionKey).heading;
        const lines = before.split(/\r?\n/);
        lines.splice(heading.line, 0, ...stubLines);
        after = lines.join(eol);
      } else {
        // no examples section: append one instead of polluting the quickstart
        after = `${before.replace(/\s*$/, '')}${eol}${eol}## Examples${stubLines.join(eol)}`;
      }
      return [mutation(path, before, after)];
    },
  },

  {
    id: 'citation.stub',
    title: 'Create or version-sync CITATION.cff',
    description: 'Adds a citation file so the project can be cited from the GitHub "Cite this repository" button, and keeps its version key in sync with package.json without touching any other field.',
    risk: 'safe',
    applies(ctx) {
      const relevant = ['library', 'research', 'dataset', 'tool', 'app'].includes(String((ctx.config.project.category || '')).toLowerCase());
      if (!relevant) return false;
      if (!exists(join(ctx.cwd, 'CITATION.cff'))) return true;
      return citationVersionDrift(ctx.cwd, ctx.config, ctx.pkg) !== null;
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'CITATION.cff');
      const before = exists(path) ? readTextIfExists(path) : null;
      if (before === null) return [mutation(path, null, renderCitationCff(ctx.config, ctx.pkg, ctx.cwd))];
      const drift = citationVersionDrift(ctx.cwd, ctx.config, ctx.pkg);
      if (!drift) return [];
      return [mutation(path, before, drift.refreshed)];
    },
  },

  {
    id: 'gitignore.entries',
    title: 'Complete .gitignore',
    description: 'Appends the standard build/dependency ignore entries when missing.',
    risk: 'safe',
    applies(ctx) {
      const path = join(ctx.cwd, '.gitignore');
      const text = exists(path) ? readTextIfExists(path) : '';
      return GITIGNORE_DEFAULTS.some((entry) => !text.includes(entry));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, '.gitignore');
      const before = exists(path) ? readTextIfExists(path) : null;
      const existing = before ? before.split('\n').map((line) => line.trim()) : [];
      const missing = GITIGNORE_DEFAULTS.filter((entry) => !existing.includes(entry));
      const header = before ? '' : '# Generated by rdk\n';
      const after = `${before ? before.replace(/\s*$/, '') : header.trim()}\n${missing.join('\n')}\n`;
      return [mutation(path, before, after)];
    },
  },

  {
    id: 'gitattributes.stub',
    title: 'Create .gitattributes',
    description: 'Normalises line endings across platforms.',
    risk: 'safe',
    applies(ctx) {
      return !exists(join(ctx.cwd, '.gitattributes'));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, '.gitattributes');
      const before = exists(path) ? readTextIfExists(path) : null;
      return [mutation(path, before, renderGitattributes())];
    },
  },

  {
    id: 'github.templates',
    title: 'Create issue and PR templates',
    description: 'Adds .github/ISSUE_TEMPLATE/*.md and PULL_REQUEST_TEMPLATE.md.',
    risk: 'safe',
    applies(ctx) {
      return !exists(join(ctx.cwd, '.github', 'ISSUE_TEMPLATE', 'bug_report.md'));
    },
    mutations(ctx) {
      const out = [];
      const specs = [
        ['.github/ISSUE_TEMPLATE/bug_report.md', renderIssueTemplate()],
        ['.github/ISSUE_TEMPLATE/feature_request.md', renderFeatureTemplate()],
        ['.github/PULL_REQUEST_TEMPLATE.md', renderPrTemplate()],
        ['.github/CODEOWNERS', renderCodeowners(ctx.cwd)],
      ];
      for (const [relative, content] of specs) {
        const path = join(ctx.cwd, relative);
        // CODEOWNERS renders null when the remote owner is unknown: never guess one
        if (exists(path) || content === null) continue;
        out.push(mutation(path, null, content));
      }
      return out;
    },
  },

  {
    id: 'dependabot.stub',
    title: 'Create .github/dependabot.yml',
    description: 'Weekly dependency and GitHub Action updates for every package ecosystem detected in the repository.',
    risk: 'safe',
    applies(ctx) {
      if (exists(join(ctx.cwd, '.github', 'dependabot.yml'))) return false;
      return dependabotEcosystems(ctx.cwd, ctx.pkg).length > 0;
    },
    mutations(ctx) {
      const path = join(ctx.cwd, '.github', 'dependabot.yml');
      return [mutation(path, null, renderDependabotYml(dependabotEcosystems(ctx.cwd, ctx.pkg)))];
    },
  },

  {
    id: 'jsonld.snippet',
    title: 'Emit or version-sync a JSON-LD snippet for the site/docs',
    description: 'Writes docs/jsonld.jsonld with SoftwareSourceCode schema derived from the config, and keeps an existing softwareVersion key in sync with package.json.',
    risk: 'safe',
    applies(ctx) {
      if (exists(join(ctx.cwd, 'docs', 'jsonld.jsonld'))) return jsonldVersionDrift(ctx.cwd, ctx.pkg) !== null;
      return Boolean(ctx.config.links.homepage || ctx.config.links.docs || ctx.config.artifacts.has_docs_site);
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'docs', 'jsonld.jsonld');
      const before = exists(path) ? readTextIfExists(path) : null;
      if (before === null) return [mutation(path, null, renderJsonLd(ctx.config, ctx.pkg, ctx.cwd))];
      const drift = jsonldVersionDrift(ctx.cwd, ctx.pkg);
      if (!drift) return [];
      return [mutation(path, before, serializeJson({ ...drift.data, softwareVersion: drift.expected }, before))];
    },
  },
];

/**
 * Returns the patches that currently change something, with their mutations.
 * With checkMutations: false only applies() is probed — for callers that must
 * not pay for mutation computation.
 */
export function planPatches(ctx, { only = null, skip = [], checkMutations = true } = {}) {
  const planned = [];
  for (const patch of PATCHES) {
    if (only && !only.includes(patch.id)) continue;
    if (skip.includes(patch.id)) continue;
    if (!patch.applies(ctx)) continue;
    if (checkMutations && patch.mutations(ctx).length === 0) continue;
    planned.push({ ...patch, compute: () => patch.mutations(ctx) });
  }
  return planned;
}

/** Applies planned mutations to disk. Returns the written paths. */
export function applyPatches(planned) {
  const written = [];
  for (const patch of planned) {
    for (const change of patch.compute()) {
      writeText(change.path, change.after);
      written.push(change.path);
    }
  }
  return written;
}
