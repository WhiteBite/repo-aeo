import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { audit } from '../src/audit/index.js';
import { AXIS_WEIGHTS } from '../src/audit/score.js';
import { buildSeedConfig, loadConfig } from '../src/config.js';
import { isSkip } from '../src/audit/checks/_shared.js';
import { githubChecks } from '../src/audit/checks/github.js';
import { readmeChecks } from '../src/audit/checks/readme.js';
import { agentsChecks } from '../src/audit/checks/agents.js';
import { npmChecks, npmPackageInvalidCheck } from '../src/audit/checks/npm.js';
import { docsChecks } from '../src/audit/checks/docs.js';
import { hygieneChecks } from '../src/audit/checks/hygiene.js';
import { makeRepo, removeRepo } from './helpers.js';

const CHECKS_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'src', 'audit', 'checks');
const AXES = new Set(Object.keys(AXIS_WEIGHTS));
const SEVERITIES = new Set(['error', 'warn', 'info']);
const EFFORTS = new Set(['S', 'M', 'L']);
const PKG = { name: 'gate-demo', version: '1.0.0', description: 'Gate context demo package' };

function isCheckLike(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && typeof value.run === 'function';
}

// checks are discovered from disk so future checks and modules join the sweep without editing this file
async function discoverChecks() {
  const discovered = [];
  for (const file of readdirSync(CHECKS_DIR).filter((name) => name.endsWith('.js')).sort()) {
    const module = await import(pathToFileURL(join(CHECKS_DIR, file)).href);
    for (const value of Object.values(module)) {
      if (Array.isArray(value)) {
        for (const item of value) if (isCheckLike(item)) discovered.push({ check: item, origin: file });
      } else if (isCheckLike(value)) {
        discovered.push({ check: value, origin: file });
      }
    }
  }
  return discovered;
}

function ctxFor(dir, { online = false, linkResults = [] } = {}) {
  const loaded = loadConfig(dir);
  return {
    cwd: dir,
    options: online ? { online: true } : {},
    config: buildSeedConfig(dir),
    configPath: loaded.configPath,
    configExists: loaded.exists,
    pkg: loaded.publishable.pkg,
    publishable: loaded.publishable,
    git: loaded.git,
    readme: null,
    github: { available: false, reason: 'offline mode (pass --online to query GitHub)', description: null, topics: [], homepageUrl: null },
    online: online ? { linkResults } : null,
  };
}

test('discovery sweeps every checks module export with unique ids', async () => {
  const discovered = await discoverChecks();
  assert.ok(discovered.length >= 20, `discovery swept only ${discovered.length} checks; the sweep is broken`);
  const swept = new Set(discovered.map(({ check }) => check.id));
  const known = [
    ...githubChecks, ...readmeChecks, ...agentsChecks, ...npmChecks, npmPackageInvalidCheck, ...docsChecks, ...hygieneChecks,
  ];
  const missed = known.filter((check) => !swept.has(check.id)).map((check) => check.id);
  assert.deepEqual(missed, [], `discovery missed known checks: ${missed.join(', ')}`);
  const ids = discovered.map(({ check }) => check.id);
  const dupes = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(dupes, [], `duplicate check ids: ${dupes.join(', ')}`);
});

test('every discovered check carries the full declarative contract', async () => {
  const discovered = await discoverChecks();
  const violations = [];
  for (const { check, origin } of discovered) {
    const at = `${origin} ${check.id}`;
    if (check.id.trim() === '') violations.push(`${at}: id must be a non-empty string`);
    if (!AXES.has(check.axis)) violations.push(`${at}: axis ${JSON.stringify(check.axis)} outside ${[...AXES].join('|')}`);
    if (typeof check.weight !== 'number' || !Number.isFinite(check.weight)) {
      violations.push(`${at}: weight must be a finite number, got ${JSON.stringify(check.weight)}`);
    }
    for (const field of ['title', 'why', 'fix']) {
      if (typeof check[field] !== 'string' || check[field].trim() === '') violations.push(`${at}: ${field} must be a non-empty string`);
    }
    if (!EFFORTS.has(check.effort)) violations.push(`${at}: effort ${JSON.stringify(check.effort)} outside S|M|L`);
  }
  assert.deepEqual(violations, [], `check contract violations:\n  ${violations.join('\n  ')}`);
});

test('every check is crash-free and emits well-formed findings on empty contexts', async () => {
  const discovered = await discoverChecks();
  const bare = makeRepo({});
  const withPkg = makeRepo({ 'package.json': JSON.stringify(PKG) });
  const onlineDir = makeRepo({});
  const crashes = [];
  const malformed = [];
  try {
    const contexts = [
      ['bare', ctxFor(bare)],
      ['pkg-no-readme', ctxFor(withPkg)],
      ['online-links', ctxFor(onlineDir, {
        online: true,
        linkResults: [
          { url: 'https://example.com/rate-limited', ok: false, status: 429, error: null },
          { url: 'https://example.com/missing', ok: false, status: 404, error: null },
        ],
      })],
    ];
    for (const { check, origin } of discovered) {
      for (const [label, ctx] of contexts) {
        let result;
        try {
          result = check.run(ctx);
        } catch (error) {
          crashes.push(`${origin} ${check.id} threw on ${label}: ${(error && error.message) || error}`);
          continue;
        }
        if (result === null || result === undefined || isSkip(result)) continue;
        const at = `${origin} ${check.id} on ${label}`;
        if (typeof result.id !== 'string' || result.id.trim() === '') malformed.push(`${at}: finding id must be a non-empty string`);
        if (!AXES.has(result.axis)) malformed.push(`${at}: finding axis ${JSON.stringify(result.axis)} outside ${[...AXES].join('|')}`);
        if (!SEVERITIES.has(result.severity)) malformed.push(`${at}: finding severity ${JSON.stringify(result.severity)} outside error|warn|info`);
        for (const field of ['title', 'why', 'fix']) {
          if (typeof result[field] !== 'string' || result[field].trim() === '') malformed.push(`${at}: finding ${field} must be a non-empty string`);
        }
        if (!EFFORTS.has(result.effort)) malformed.push(`${at}: finding effort ${JSON.stringify(result.effort)} outside S|M|L`);
        if (typeof result.weight !== 'number' || !Number.isFinite(result.weight)) {
          malformed.push(`${at}: finding weight must be a finite number, got ${JSON.stringify(result.weight)}`);
        }
      }
    }
  } finally {
    removeRepo(bare);
    removeRepo(withPkg);
    removeRepo(onlineDir);
  }
  assert.deepEqual(crashes, [], `checks crashed on empty contexts:\n  ${crashes.join('\n  ')}`);
  assert.deepEqual(malformed, [], `malformed findings on empty contexts:\n  ${malformed.join('\n  ')}`);
});

test('full-audit tallies stay consistent on scratch repos', async () => {
  const bare = makeRepo({ 'package.json': JSON.stringify(PKG) });
  const docsRepo = makeRepo({
    'package.json': JSON.stringify(PKG),
    'README.md': `# Gate demo\n\nA readme with enough body text to count as a real readme for the tally invariants.\n\n## Quickstart\n\n\`\`\`bash\nnpm install gate-demo\n\`\`\`\n`,
    'AGENTS.md': `# Agents\n\n## Commands\n\n- npm test\n- npm run lint\n- npm run build\n\n## Do / Don't\n\nDo run the tests. Don't bump versions.\n`,
    'llms.txt': `# Gate demo\n\n> A demo project exercising the docs axis of the audit.\n\n- [README](README.md)\n`,
    '.discoverability/project.yml': 'project:\n  name: gate-demo\nartifacts:\n  has_docs_site: true\n',
  });
  try {
    for (const dir of [bare, docsRepo]) {
      const report = await audit(dir, { online: false });
      assert.ok(
        report.summary.passedChecks <= report.summary.checks,
        `${dir}: passedChecks ${report.summary.passedChecks} exceeds run checks ${report.summary.checks}`,
      );
      for (const [axis, entry] of Object.entries(report.score.axes)) {
        assert.equal(
          entry.applicable,
          entry.total > 0,
          `${dir} ${axis}: applicable ${entry.applicable} must mirror tally total ${entry.total}`,
        );
      }
    }
  } finally {
    removeRepo(bare);
    removeRepo(docsRepo);
  }
});

test('a claimed npm axis with a broken package.json cannot phantom-pass', async () => {
  const dir = makeRepo({
    'package.json': '{ broken json',
    '.discoverability/project.yml': 'project:\n  name: phantom-npm\nartifacts:\n  has_npm_package: true\n',
  });
  try {
    const report = await audit(dir, { online: false });
    assert.equal(report.environment.has_npm_package, true);
    const invalid = report.findings.find((f) => f.id === 'npm.package_invalid');
    assert.ok(invalid, 'expected an npm.package_invalid finding');
    assert.equal(invalid.severity, 'error');
    assert.ok(
      report.score.axes.npm.score < 100,
      `npm axis must not pass at the aggregate level, got ${report.score.axes.npm.score}`,
    );
    assert.ok(report.summary.passedChecks <= report.summary.checks);
    for (const [axis, entry] of Object.entries(report.score.axes)) {
      assert.equal(entry.applicable, entry.total > 0, `${axis}: applicable must mirror tally total`);
    }
  } finally {
    removeRepo(dir);
  }
});
