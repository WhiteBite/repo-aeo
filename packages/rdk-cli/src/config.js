/**
 * Loads and validates `.discoverability/project.yml`, the single source of
 * truth for a repository's discoverability metadata.
 */
import { join } from 'node:path';
import { parse, YamlError } from './yaml.js';
import { exists, readTextIfExists, readJsonIfExists } from './util/fs.js';
import { gitInfo } from './util/git.js';

export const CONFIG_RELATIVE_PATH = '.discoverability/project.yml';

export const DEFAULT_CONFIG = {
  project: {
    name: null,
    one_liner: null,
    description: null,
    category: 'library',
  },
  audiences: [],
  use_cases: [],
  keywords: {
    github_topics: [],
    npm_keywords: [],
  },
  links: {
    homepage: null,
    docs: null,
    demo: null,
    issues: null,
  },
  quickstart: {
    prerequisites: [],
    install: null,
    run: null,
    test: null,
  },
  artifacts: {
    has_npm_package: false,
    has_docs_site: false,
  },
  differentiators: [],
  safety: {
    allow_autofix: false,
    require_ack_for_publish: true,
  },
};

const CATEGORIES = new Set([
  'library',
  'app',
  'template',
  'research',
  'tool',
  'dataset',
  'mcp-server',
  'docs',
  'other',
]);

/** Deep-merges defaults, then the user config, then package.json-derived facts. */
export function loadConfig(cwd = process.cwd()) {
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);
  const warnings = [];
  let userConfig = {};

  if (exists(configPath)) {
    const text = readTextIfExists(configPath);
    try {
      const parsed = parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        userConfig = parsed;
      } else {
        warnings.push({ code: 'config.not_a_mapping', message: `${CONFIG_RELATIVE_PATH} must contain a YAML mapping at the top level.` });
      }
    } catch (error) {
      if (error instanceof YamlError) {
        warnings.push({ code: 'config.parse_error', message: `${CONFIG_RELATIVE_PATH}: ${error.message}` });
      } else {
        throw error;
      }
    }
  }

  const config = mergeDeep(DEFAULT_CONFIG, userConfig);
  const pkg = readJsonIfExists(join(cwd, 'package.json'));
  const git = gitInfo(cwd);

  if (pkg) {
    config.project.name = config.project.name || pkg.name || null;
    config.project.description = config.project.description || pkg.description || null;
    config.links.homepage = config.links.homepage || pkg.homepage || null;
    config.links.issues = config.links.issues || (typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs && pkg.bugs.url) || null;
    config.links.docs = config.links.docs || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url) || null;
    if (config.artifacts.has_npm_package === false && pkg.name) {
      config.artifacts.has_npm_package = true;
    }
    if (pkg.keywords && Array.isArray(pkg.keywords) && config.keywords.npm_keywords.length === 0) {
      config.keywords.npm_keywords = [...pkg.keywords];
    }
  }

  if (git.owner && git.repo && !config.links.issues) {
    config.links.issues = `https://github.com/${git.owner}/${git.repo}/issues`;
  }

  return { config, configPath, exists: exists(configPath), warnings, pkg, git };
}

/** Deep clone for plain objects and arrays. */
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return mergeDeep(value, {});
  return value;
}

/**
 * Deep-merges `override` into a deep clone of `base`.
 * Never shares nested references with either input — otherwise the module-level
 * DEFAULT_CONFIG would be mutated by the first audit that runs in a process.
 */
export function mergeDeep(base, override) {
  if (Array.isArray(base)) return base.map(clone);
  if (!base || typeof base !== 'object') return base;
  const out = {};
  for (const [key, value] of Object.entries(base)) out[key] = clone(value);
  if (!override || typeof override !== 'object' || Array.isArray(override)) return out;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = mergeDeep(current, value);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

export function isKnownCategory(category) {
  return CATEGORIES.has(String(category || '').toLowerCase());
}

export function knownCategories() {
  return [...CATEGORIES];
}

/**
 * Builds a seed config from facts that already exist in the repository
 * (package.json, git remote). Used by `rdk init` — nothing is invented.
 */
export function buildSeedConfig(cwd = process.cwd()) {
  const { config, pkg, git } = loadConfig(cwd);
  const project = { ...config.project };
  if (!project.name) project.name = (pkg && pkg.name) || (git.repo ? `${git.owner}/${git.repo}` : 'my-project');
  if (!project.one_liner) project.one_liner = (pkg && pkg.description) || 'TODO: one sentence describing what this does and who it is for';
  if (!project.description) project.description = project.one_liner;
  if (!project.category || project.category === 'library') {
    const name = String((pkg && pkg.name) || project.name || '').toLowerCase();
    if (name.includes('mcp')) project.category = 'mcp-server';
    else if (pkg && pkg.bin) project.category = 'tool';
    else if (pkg && pkg.name) project.category = 'library';
  }
  const keywords = {
    github_topics: config.keywords.github_topics,
    npm_keywords: uniqStrings([
      ...(config.keywords.npm_keywords || []),
      ...((pkg && pkg.keywords) || []),
      ...suggestTopics(project, pkg),
    ]).slice(0, 15),
  };
  if (keywords.github_topics.length === 0) {
    keywords.github_topics = suggestTopics(project, pkg);
  }
  const links = { ...config.links };
  if (git.owner && git.repo && !links.issues) links.issues = `https://github.com/${git.owner}/${git.repo}/issues`;
  const quickstart = { ...config.quickstart };
  const scripts = (pkg && pkg.scripts) || {};
  if (!quickstart.install && pkg && pkg.name) quickstart.install = `npm install ${pkg.name}`;
  if (!quickstart.run && (scripts.start || scripts.dev)) quickstart.run = `npm run ${scripts.start ? 'start' : 'dev'}`;
  if (!quickstart.test && (scripts.test || scripts['test:unit'])) quickstart.test = `npm run ${scripts.test ? 'test' : 'test:unit'}`;
  if (quickstart.prerequisites.length === 0) quickstart.prerequisites = ['Node.js >= 18'];

  return {
    ...config,
    project,
    keywords,
    links,
    quickstart,
    artifacts: {
      has_npm_package: Boolean(pkg && pkg.name),
      has_docs_site: Boolean(config.artifacts.has_docs_site),
    },
  };
}

function uniqStrings(list) {
  return [...new Set(list.filter((item) => typeof item === 'string' && item.trim() !== ''))];
}

/** Derives a starting topic set from package name, keywords and category. */
export function suggestTopics(project, pkg) {
  const base = new Set(['open-source', 'developer-tools']);
  const category = String(project.category || '').toLowerCase();
  if (category) base.add(category);
  const name = String((pkg && pkg.name) || project.name || '').toLowerCase();
  for (const token of name.split(/[/@_-]+/)) {
    if (token.length >= 3 && !['com', 'org', 'js', 'node'].includes(token)) base.add(token);
  }
  for (const keyword of [...((pkg && pkg.keywords) || []), ...((project.description || '').toLowerCase().match(/[a-z][a-z-]{4,}/g) || [])]) {
    const token = String(keyword).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    if (token.length >= 4 && base.size < 12) base.add(token);
  }
  return [...base].slice(0, 12);
}
