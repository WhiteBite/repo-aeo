/**
 * Audit orchestrator: collects facts (never invents them), runs every
 * applicable check, scores the result and returns a serialisable report.
 */
import { join, relative } from 'node:path';
import { loadConfig } from '../config.js';
import { readTextIfExists, exists, readJsonIfExists } from '../util/fs.js';
import { gitInfo } from '../util/git.js';
import { repoWebUrl } from '../util/repo.js';
import { run } from '../util/proc.js';
import { probeUrls, isProbeable } from '../util/http.js';
import { parseMarkdown } from './checks/_shared.js';
import { githubChecks } from './checks/github.js';
import { readmeChecks } from './checks/readme.js';
import { agentsChecks } from './checks/agents.js';
import { npmChecks } from './checks/npm.js';
import { docsChecks } from './checks/docs.js';
import { hygieneChecks } from './checks/hygiene.js';
import { AXIS_WEIGHTS, computeScore } from './score.js';

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const MAX_PROBED_LINKS = 25;

/** Reads live GitHub metadata with the `gh` CLI. Never throws, never invents. */
export function collectGithub(cwd, config, git, { enabled = false } = {}) {
  const empty = { available: false, reason: 'not requested', description: null, topics: [], homepageUrl: null };
  if (!enabled) return { ...empty, reason: 'offline mode (pass --online to query GitHub)' };
  if (!git.isRepo || !git.owner || !git.repo) return { ...empty, reason: 'no GitHub remote detected' };
  const result = run('gh', ['repo', 'view', `${git.owner}/${git.repo}`, '--json', 'description,homepageUrl,repositoryTopics'], { cwd, timeout: 15000 });
  if (!result.ok) return { ...empty, reason: `gh CLI unavailable or not authenticated (${result.stderr.trim().slice(0, 120) || 'unknown error'})` };
  try {
    const json = JSON.parse(result.stdout);
    return {
      available: true,
      reason: null,
      description: json.description || null,
      homepageUrl: json.homepageUrl || null,
      topics: Array.isArray(json.repositoryTopics) ? json.repositoryTopics.map((t) => (t && t.name) || String(t)) : [],
    };
  } catch {
    return { ...empty, reason: 'could not parse gh output' };
  }
}

function collectLinks(cwd) {
  const urls = new Set();
  for (const name of ['README.md', 'llms.txt', 'llms-full.txt']) {
    const path = join(cwd, name);
    if (!exists(path)) continue;
    const doc = parseMarkdown(readTextIfExists(path));
    for (const link of doc.links) {
      if (isProbeable(link.url)) urls.add(link.url);
    }
  }
  const config = loadConfig(cwd).config;
  for (const value of Object.values(config.links || {})) {
    if (isProbeable(value)) urls.add(value);
  }
  return [...urls].slice(0, MAX_PROBED_LINKS);
}

/** Runs the full audit. Returns a plain JSON-serialisable report object. */
export async function audit(cwd = process.cwd(), options = {}) {
  const started = Date.now();
  const loaded = loadConfig(cwd);
  const { config, configPath, warnings, pkg, git } = loaded;
  const readmePath = join(cwd, 'README.md');
  const readme = exists(readmePath) ? readTextIfExists(readmePath) : null;

  const github = collectGithub(cwd, config, git, { enabled: Boolean(options.online && options.github !== false) });

  let linkResults = [];
  if (options.online) {
    const urls = collectLinks(cwd);
    if (urls.length > 0) linkResults = await probeUrls(urls, { timeoutMs: options.linkTimeout || 6000 });
  }

  const publishable = loaded.publishable || { pkg, isPrivate: Boolean(pkg && pkg.private) };
  const hasNpm = Boolean(config.artifacts.has_npm_package) || Boolean(publishable.pkg && !publishable.isPrivate);
  const hasSite = Boolean(config.artifacts.has_docs_site) || Boolean(config.links.homepage || config.links.docs);

  const ctx = {
    cwd,
    options,
    config,
    configPath,
    configExists: loaded.exists,
    pkg: publishable.pkg,
    publishable,
    git,
    readme,
    github,
    online: options.online ? { linkResults } : null,
  };

  const registry = [
    ...githubChecks,
    ...readmeChecks,
    ...agentsChecks,
    ...(hasNpm ? npmChecks : []),
    ...(hasSite ? docsChecks : []),
    ...hygieneChecks,
  ];

  const findings = [];
  const perAxis = {};
  for (const definition of registry) {
    const tally = perAxis[definition.axis] || { passed: 0, total: 0 };
    tally.total += 1;
    let result = null;
    try {
      result = definition.run(ctx);
    } catch (error) {
      result = {
        id: definition.id,
        axis: definition.axis,
        severity: 'warn',
        title: `Check crashed: ${definition.id}`,
        why: String((error && error.message) || error),
        fix: 'Please report this as a bug.',
        effort: 'S',
        autoFixable: false,
        patchId: null,
        weight: definition.weight,
      };
    }
    if (result === null || result === undefined) {
      tally.passed += 1;
    } else {
      findings.push(result);
    }
    perAxis[definition.axis] = tally;
  }

  const applicableAxes = Object.keys(AXIS_WEIGHTS).filter((axis) => {
    if (axis === 'npm') return hasNpm;
    if (axis === 'docs') return hasSite;
    return true;
  });

  const score = computeScore(perAxis, applicableAxes);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.weight - a.weight);

  const summary = {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    info: findings.filter((f) => f.severity === 'info').length,
    autofixable: findings.filter((f) => f.autoFixable).length,
    checks: registry.length,
    passedChecks: Object.values(perAxis).reduce((sum, t) => sum + t.passed, 0),
  };

  return {
    schema: 'rdk-audit/1',
    tool: '@repo-aeo/rdk-cli',
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    project: {
      name: config.project.name || pkg?.name || git.repo || null,
      category: config.project.category,
      version: pkg?.version || null,
      config_path: loaded.exists ? '.discoverability/project.yml' : null,
      // Derived from the audited repository's remote, so report footers never
      // point at the wrong project.
      repo_url: repoWebUrl(cwd),
    },
    environment: {
      offline: !options.online,
      github_source: github.available ? 'live (gh api)' : github.reason,
      links_checked: linkResults.length,
      has_npm_package: hasNpm,
      npm_package_path: publishable.pkg ? relative(cwd, publishable.path) : null,
      has_docs_site: hasSite,
    },
    score,
    summary,
    findings,
    next_actions: findings
      .filter((f) => f.severity !== 'info')
      .slice(0, 8)
      .map((f) => ({ id: f.id, severity: f.severity, fix: f.fix, effort: f.effort })),
    config_warnings: warnings,
  };
}

export { readJsonIfExists };
