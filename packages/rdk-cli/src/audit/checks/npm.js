/**
 * Axis 4 — npm readiness: package.json metadata, exports map, types, tarball
 * hygiene, dependency health. Only applied when the project ships a package.
 */
import { check, finding } from './_shared.js';
import { exists, readJsonIfExists, readTextIfExists } from '../../util/fs.js';
import { join, dirname } from 'node:path';

function repositoryUrl(pkg) {
  if (!pkg) return null;
  if (typeof pkg.repository === 'string') return pkg.repository;
  if (pkg.repository && typeof pkg.repository.url === 'string') return pkg.repository.url;
  return null;
}

function bugsUrl(pkg) {
  if (!pkg) return null;
  if (typeof pkg.bugs === 'string') return pkg.bugs;
  if (pkg.bugs && typeof pkg.bugs.url === 'string') return pkg.bugs.url;
  return null;
}

function hasExports(pkg) {
  return Boolean(pkg && (pkg.exports || pkg.main || pkg.module));
}

function exportsConditions(pkg) {
  if (!pkg || !pkg.exports) return [];
  if (typeof pkg.exports === 'string') return ['default'];
  const conditions = new Set();
  const walk = (node) => {
    if (typeof node === 'string') {
      conditions.add('default');
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('.')) {
          // subpath export: descend to find its conditions
          walk(value);
          continue;
        }
        if (key === 'default') {
          conditions.add('default');
          continue;
        }
        if (typeof value === 'string') conditions.add(key);
        else walk(value);
      }
    }
  };
  walk(pkg.exports);
  return [...conditions];
}

export const npmChecks = [
  check({
    id: 'npm.metadata',
    axis: 'npm',
    weight: 10,
    title: 'package.json carries description, keywords, repository, homepage, bugs',
    why: 'npm search indexes description and keywords; the repository/homepage/bugs fields are what agents and crawlers follow to verify the package. Missing metadata directly lowers registry search ranking.',
    fix: 'Fill description, keywords (>=5), repository, homepage and bugs in package.json. `rdk fix` seeds them from .discoverability/project.yml.',
    effort: 'S',
    autoFixable: true,
    patchId: 'package.metadata',
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      const missing = [];
      if (!pkg.description) missing.push('description');
      if (!Array.isArray(pkg.keywords) || pkg.keywords.length === 0) missing.push('keywords');
      if (!repositoryUrl(pkg)) missing.push('repository');
      if (!pkg.homepage) missing.push('homepage');
      if (!bugsUrl(pkg)) missing.push('bugs');
      if (missing.length === 0) return null;
      const severity = missing.length >= 3 ? 'error' : 'warn';
      return finding({ id: this.id, axis: this.axis, severity, title: `package.json is missing: ${missing.join(', ')}`, why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'package.metadata', weight: this.weight });
    },
  }),

  check({
    id: 'npm.keywords_quality',
    axis: 'npm',
    weight: 8,
    title: 'package.json has 5+ relevant keywords',
    why: 'keywords are the primary search signal inside the npm registry. Thin keyword sets make the package undiscoverable even when it is the best tool for the job.',
    fix: 'Reuse keywords.npm_keywords from .discoverability/project.yml and run `rdk fix`.',
    effort: 'S',
    autoFixable: true,
    patchId: 'package.keywords',
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.filter((k) => typeof k === 'string' && k.trim() !== '') : [];
      if (keywords.length === 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'No keywords in package.json', why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'package.keywords', weight: this.weight });
      }
      if (keywords.length < 5) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `Only ${keywords.length} keywords in package.json (target >= 5)`, why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'package.keywords', weight: this.weight });
      }
      if (keywords.length > 20) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: `${keywords.length} keywords dilutes the search signal`, why: 'Keyword stuffing is filtered by registry search and looks like spam to reviewers.', fix: 'Trim to the 10–15 most specific terms.', effort: 'S', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'npm.exports',
    axis: 'npm',
    weight: 12,
    title: 'exports map supports both import and require',
    why: 'A library without a correct exports map breaks one of the two consumers (ESM or CJS), and broken installs are the fastest route to a bad reputation in an agent-generated answer.',
    fix: 'Add an exports map with "import" and "require" conditions, or a single "default". Verify with `rdk npm-surface`.',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      if (!pkg.exports) {
        if (pkg.main) {
          return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'package.json has "main" but no "exports" map', why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
        }
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No "exports" map (library consumers need it)', why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
      }
      if (typeof pkg.exports === 'string') return null;
      const conditions = exportsConditions(pkg);
      const hasImport = conditions.includes('import') || conditions.includes('default');
      const hasRequire = conditions.includes('require') || conditions.includes('default');
      if (!hasImport || !hasRequire) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: `exports map is missing the ${!hasImport ? '"import"' : '"require"'} condition`, why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
      }
      const subpaths = typeof pkg.exports === 'object' ? Object.keys(pkg.exports).filter((k) => k.startsWith('.')) : [];
      for (const subpath of subpaths) {
        const node = pkg.exports[subpath];
        if (node && typeof node === 'object' && !node.types && !node.import && !node.require && !node.default) {
          return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `exports["${subpath}"] has no types/import/require/default entry`, why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
        }
      }
      return null;
    },
  }),

  check({
    id: 'npm.types',
    axis: 'npm',
    weight: 10,
    title: 'TypeScript types are declared',
    why: 'Without types, TypeScript users (and TS-aware agents) cannot use the package without extra work, which quietly removes it from consideration.',
    fix: 'Ship a "types" entry (or typesVersions when types differ per TS version) pointing at a .d.ts file.',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      const exportsText = pkg.exports ? JSON.stringify(pkg.exports) : '';
      const hasTypes = Boolean(pkg.types || pkg.typings) || exportsText.includes('.d.ts') || exportsText.includes('"types"');
      if (hasTypes) return null;
      const isTsProject = exists(join(ctx.cwd, 'tsconfig.json'));
      if (isTsProject) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'TypeScript project without a types entry in package.json', why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
      }
      return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No TypeScript types declared', why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
    },
  }),

  check({
    id: 'npm.side_effects',
    axis: 'npm',
    weight: 4,
    title: 'sideEffects is declared (only when you are sure)',
    why: 'sideEffects: false lets bundlers tree-shake the package. Declaring it falsely breaks consumers that rely on CSS or polyfill side effects.',
    fix: 'For a pure library add "sideEffects": false. If the package injects styles or patches globals, list those files instead.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg || !pkg.exports) return null;
      if (pkg.sideEffects === undefined) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'sideEffects is not declared', why: this.why, fix: this.fix, effort: 'S', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'npm.files_hygiene',
    axis: 'npm',
    weight: 8,
    title: 'Published tarball contains the discoverability artifacts',
    why: 'llms.txt, llms-full.txt and AGENTS.md only help if they ship inside the npm tarball — that is the precedent set by libraries such as ngx-mask.',
    fix: 'Add "llms.txt", "llms-full.txt" and "AGENTS.md" to the files array (or .npmignore).',
    effort: 'S',
    autoFixable: true,
    patchId: 'package.files',
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      const files = Array.isArray(pkg.files) ? pkg.files : null;
      const hasNpmignore = exists(join(ctx.cwd, '.npmignore'));
      if (!files && !hasNpmignore) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No "files" array and no .npmignore — the tarball is guesswork', why: this.why, fix: 'Add an explicit "files" array.', effort: 'S', autoFixable: true, patchId: 'package.files', weight: this.weight });
      }
      const packageDir = ctx.publishable && ctx.publishable.path ? dirname(ctx.publishable.path) : ctx.cwd;
      const wanted = ['llms.txt', 'llms-full.txt', 'AGENTS.md'].filter((name) => exists(join(packageDir, name)));
      if (files && wanted.length > 0) {
        const missing = wanted.filter((name) => !files.some((entry) => String(entry).replace(/^\.\//, '') === name));
        if (missing.length > 0) {
          return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `files array omits ${missing.join(', ')}`, why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'package.files', weight: this.weight });
        }
      }
      if (files) {
        const suspicious = files.filter((entry) => /(^|\/)(\.env|\.git|secrets?|id_rsa|\.npmrc)/i.test(String(entry)));
        if (suspicious.length > 0) {
          return finding({ id: this.id, axis: this.axis, severity: 'error', title: `files array contains suspicious entries: ${suspicious.join(', ')}`, why: 'Publishing credentials or VCS metadata is a security incident.', fix: 'Remove those entries immediately.', effort: 'S', weight: this.weight });
        }
      }
      return null;
    },
  }),

  check({
    id: 'npm.engines',
    axis: 'npm',
    weight: 4,
    title: 'engines.node declares the supported range',
    why: 'Consumers (and install-time tooling) need to know which Node versions are supported; missing engines produce cryptic runtime failures.',
    fix: 'Add "engines": { "node": ">=18" }.',
    effort: 'S',
    autoFixable: true,
    patchId: 'package.engines',
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      if (!pkg.engines || !pkg.engines.node) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'engines.node is not declared', why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'package.engines', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'npm.version_stability',
    axis: 'npm',
    weight: 5,
    title: 'Package version is stable (>= 1.0.0)',
    why: 'npms.io awards a completeness bonus when a package is >= 1.0.0, not deprecated, has README, has tests and few open issues. Staying on 0.x caps your registry score.',
    fix: 'When the API is stable, bump to 1.0.0 (semver-major). Never do this implicitly — propose it and let the maintainer confirm.',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg || !pkg.version) return null;
      if (String(pkg.deprecated || '').length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'Package is marked deprecated', why: this.why, fix: 'Remove the "deprecated" field.', effort: 'S', weight: this.weight });
      }
      const major = Number.parseInt(String(pkg.version).split('.')[0], 10);
      if (Number.isFinite(major) && major < 1) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: `Version ${pkg.version} is pre-1.0 (npms.io completeness bonus needs >= 1.0.0)`, why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'npm.test_script',
    axis: 'npm',
    weight: 6,
    title: 'package.json defines a test script',
    why: 'Tests are part of the npms.io quality/maintenance signal and the fastest trust signal for an agent deciding whether to recommend the project.',
    fix: 'Add a "test" script (even a smoke test counts).',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      const scripts = pkg.scripts || {};
      if (!scripts.test && !scripts['test:unit'] && !scripts.check) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No test script in package.json', why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'npm.dependency_ranges',
    axis: 'npm',
    weight: 5,
    title: 'Dependency ranges are resolvable and pinned sanely',
    why: 'Wildcard and git-URL dependencies break reproducible installs and make security auditing impossible.',
    fix: 'Replace "*"/"latest" with explicit ranges; move git URLs to a documented devDependency or vendor the code.',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const pkg = ctx.pkg;
      if (!pkg) return null;
      const problems = [];
      for (const field of ['dependencies', 'devDependencies']) {
        const deps = pkg[field];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, range] of Object.entries(deps)) {
          if (typeof range !== 'string') continue;
          if (range === '*' || range === 'latest') problems.push(`${field}.${name}@${range}`);
          if (/^(git|git\+|https?:|file:)/.test(range)) problems.push(`${field}.${name} -> ${range.slice(0, 24)}`);
        }
      }
      if (problems.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `Unsafe dependency ranges: ${problems.slice(0, 4).join(', ')}`, why: this.why, fix: this.fix, effort: 'M', weight: this.weight });
      }
      return null;
    },
  }),
];
