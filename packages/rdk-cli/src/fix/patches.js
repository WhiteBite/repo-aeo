/**
 * Safe autofix patches. Every patch is:
 *   - idempotent (running `rdk fix` twice changes nothing the second time)
 *   - additive or normalising (no deletion of user content)
 *   - reversible through git (the Action commits to a dedicated branch)
 *
 * Patches never publish, tag, bump versions or force-push.
 */
import { join } from 'node:path';
import { exists, readTextIfExists, writeText, readJsonIfExists } from '../util/fs.js';
import { parseMarkdown, slugifyTopic, uniq } from '../audit/checks/_shared.js';
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
  mergeGenerated,
  repositoryUrl,
} from '../generate/index.js';

const GITIGNORE_DEFAULTS = ['node_modules/', 'dist/', 'build/', '*.log', '.DS_Store', '.env'];

function mutation(path, before, after) {
  return { path, before, after, created: before === null };
}

/** Rewrites a `key:` block (inline or list form) inside YAML text, preserving comments. */
function replaceYamlList(text, key, values) {
  const lines = String(text).split('\n');
  const keyRe = new RegExp(`^(\\s*)${key}\\s*:(.*)$`);
  const index = lines.findIndex((line) => keyRe.test(line));
  if (index === -1) return { text, changed: false };
  const indent = lines[index].match(keyRe)[1];
  const inline = lines[index].match(keyRe)[2].trim();
  if (inline.startsWith('#')) {
    // key with only a comment on the same line: keep the comment, add the list below
    const comment = inline;
    const rendered = values.map((value) => `${indent}  - ${JSON.stringify(value)}`).join('\n');
    lines.splice(index, 1, `${indent}${key}: ${comment}`, rendered);
    return { text: lines.join('\n'), changed: true };
  }
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') {
      end += 1;
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= indent.length || !line.trim().startsWith('-')) break;
    end += 1;
  }
  const rendered = values.length === 0
    ? `${indent}${key}: []`
    : `${indent}${key}:\n${values.map((value) => `${indent}  - ${JSON.stringify(value)}`).join('\n')}`;
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

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readmeBase(ctx) {
  const path = join(ctx.cwd, 'README.md');
  const onDisk = exists(path);
  // When the README does not exist yet, evaluate against the scaffold that
  // `readme.generate` will produce in the same run, so patches stay ordered.
  const before = onDisk ? readTextIfExists(path) : renderReadme(ctx.config, ctx.pkg);
  return { path, onDisk, before };
}

/** Returns the body of the section that should hold examples. */
function exampleSectionBody(doc) {
  const key = ['examples', 'usage', 'example', 'quickstart', 'getting started'].find((candidate) => doc.sections.has(candidate));
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
      const { text } = replaceYamlList(before, 'github_topics', normalized);
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
    description: 'Creates a structured README scaffold (quickstart, audiences, use cases, examples, why, status).',
    risk: 'safe',
    applies(ctx) {
      const path = join(ctx.cwd, 'README.md');
      return !exists(path) || readTextIfExists(path).trim().length < 40;
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'README.md');
      const before = exists(path) ? readTextIfExists(path) : null;
      return [mutation(path, before, renderReadme(ctx.config, ctx.pkg))];
    },
  },

  {
    id: 'readme.sections_stub',
    title: 'Insert missing README sections',
    description: 'Appends stubs for Who is it for / Use cases / Why choose this when absent.',
    risk: 'safe',
    applies(ctx) {
      const doc = parseMarkdown(readmeBase(ctx).before);
      return REQUIRED_README_SECTIONS.some((section) => !doc.sections.has(section.key));
    },
    mutations(ctx) {
      const { path, before } = readmeBase(ctx);
      const doc = parseMarkdown(before);
      const additions = [];
      for (const section of REQUIRED_README_SECTIONS) {
        if (doc.sections.has(section.key)) continue;
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
      const after = `${before.replace(/\s*$/, '')}\n\n${additions.join('\n').trim()}\n`;
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
      const doc = parseMarkdown(readTextIfExists(path));
      if (doc.sections.has('quickstart') || doc.sections.has('getting started')) return false;
      const quickstart = ctx.config.quickstart || {};
      return Boolean(quickstart.install && quickstart.run);
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'README.md');
      const before = readTextIfExists(path);
      const lines = before.split('\n');
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
      if (insertAt === -1) insertAt = 0;
      else insertAt += 1;
      lines.splice(insertAt, 0, ...block);
      return [mutation(path, before, lines.join('\n'))];
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
      return [mutation(pkg.path, pkg.text, serializeJson(json))];
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
      return [mutation(pkg.path, pkg.text, serializeJson(json))];
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
      const wanted = ['llms.txt', 'llms-full.txt', 'AGENTS.md'].filter((name) => exists(join(ctx.cwd, name)));
      return wanted.some((name) => !pkg.json.files.includes(name));
    },
    mutations(ctx) {
      const pkg = readPackageJson(ctx);
      const json = { ...pkg.json };
      const wanted = ['llms.txt', 'llms-full.txt', 'AGENTS.md'].filter((name) => exists(join(ctx.cwd, name)));
      const files = Array.isArray(json.files) ? [...json.files] : [];
      for (const name of wanted) {
        if (!files.includes(name)) files.push(name);
      }
      json.files = files;
      return [mutation(pkg.path, pkg.text, serializeJson(json))];
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
      return [mutation(pkg.path, pkg.text, serializeJson(json))];
    },
  },

  {
    id: 'license.stub',
    title: 'Create a LICENSE file',
    description: 'Adds an MIT LICENSE so the project can legally be reused and recommended.',
    risk: 'safe',
    applies(ctx) {
      const names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];
      return !names.some((name) => exists(join(ctx.cwd, name)));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'LICENSE');
      const holder = (ctx.config.project && ctx.config.project.name) || 'the authors';
      return [mutation(path, null, renderLicense(holder))];
    },
  },

  {
    id: 'security.stub',
    title: 'Create SECURITY.md',
    description: 'Adds a security policy with a private reporting channel.',
    risk: 'safe',
    applies(ctx) {
      return !exists(join(ctx.cwd, 'SECURITY.md')) && !exists(join(ctx.cwd, '.github', 'SECURITY.md'));
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
      return !exists(join(ctx.cwd, 'CONTRIBUTING.md')) && !exists(join(ctx.cwd, '.github', 'CONTRIBUTING.md'));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'CONTRIBUTING.md');
      return [mutation(path, null, renderContributingMd(ctx.config.project && ctx.config.project.name))];
    },
  },

  {
    id: 'readme.examples_stub',
    title: 'Add example stubs to the README',
    description: 'Inserts a runnable-looking example stub when the examples/usage section has fewer than two code blocks.',
    risk: 'safe',
    applies(ctx) {
      const doc = parseMarkdown(readmeBase(ctx).before);
      const body = exampleSectionBody(doc);
      const blocks = (body.match(/^(?:```|~~~)/gm) || []).length / 2;
      return blocks < 2;
    },
    mutations(ctx) {
      const { path, before } = readmeBase(ctx);
      const quickstart = ctx.config.quickstart || {};
      const run = quickstart.run || 'npm start';
      const stub = [
        '',
        '### Example (replace with a real one)',
        '',
        '```bash',
        run,
        '```',
        '',
      ].join('\n');
      const doc = parseMarkdown(before);
      const sectionKey = ['examples', 'usage', 'example'].find((key) => doc.sections.has(key));
      let after;
      if (sectionKey) {
        // insert the stub right after the section heading
        const heading = doc.sections.get(sectionKey).heading;
        const lines = before.split('\n');
        lines.splice(heading.line, 0, ...stub.split('\n'));
        after = lines.join('\n');
      } else {
        // no examples section: append one instead of polluting the quickstart
        after = `${before.replace(/\s*$/, '')}\n\n## Examples${stub}`;
      }
      return [mutation(path, before, after)];
    },
  },

  {
    id: 'citation.stub',
    title: 'Create CITATION.cff',
    description: 'Adds a citation file so the project can be cited from the GitHub "Cite this repository" button.',
    risk: 'safe',
    applies(ctx) {
      const relevant = ['library', 'research', 'dataset', 'tool', 'app'].includes(String((ctx.config.project.category || '')).toLowerCase());
      return relevant && !exists(join(ctx.cwd, 'CITATION.cff'));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'CITATION.cff');
      const before = exists(path) ? readTextIfExists(path) : null;
      return [mutation(path, before, renderCitationCff(ctx.config, ctx.pkg))];
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
        if (exists(path)) continue;
        out.push(mutation(path, null, content));
      }
      return out;
    },
  },

  {
    id: 'jsonld.snippet',
    title: 'Emit a JSON-LD snippet for the site/docs',
    description: 'Writes docs/jsonld.jsonld with SoftwareSourceCode schema derived from the config.',
    risk: 'safe',
    applies(ctx) {
      const hasSite = Boolean(ctx.config.links.homepage || ctx.config.links.docs || ctx.config.artifacts.has_docs_site);
      return hasSite && !exists(join(ctx.cwd, 'docs', 'jsonld.jsonld'));
    },
    mutations(ctx) {
      const path = join(ctx.cwd, 'docs', 'jsonld.jsonld');
      const before = exists(path) ? readTextIfExists(path) : null;
      return [mutation(path, before, renderJsonLd(ctx.config, ctx.pkg))];
    },
  },
];

/** Returns the patches that currently change something, with their mutations. */
export function planPatches(ctx, { only = null, skip = [] } = {}) {
  const planned = [];
  for (const patch of PATCHES) {
    if (only && !only.includes(patch.id)) continue;
    if (skip.includes(patch.id)) continue;
    if (!patch.applies(ctx)) continue;
    const mutations = patch.mutations(ctx);
    if (mutations.length === 0) continue;
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
