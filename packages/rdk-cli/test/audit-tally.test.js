import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit/index.js';
import { computeScore } from '../src/audit/score.js';
import { githubChecks } from '../src/audit/checks/github.js';
import { makeRepo, removeRepo } from './helpers.js';

function assertTallyInvariants(report) {
  assert.ok(
    report.summary.passedChecks <= report.summary.checks,
    `passedChecks ${report.summary.passedChecks} exceeds run checks ${report.summary.checks}`,
  );
  const axisTotal = Object.values(report.score.axes).reduce((sum, axis) => sum + axis.total, 0);
  assert.equal(axisTotal, report.summary.checks, 'summary.checks must equal the sum of per-axis totals');
  for (const [name, axis] of Object.entries(report.score.axes)) {
    assert.ok(axis.passed <= axis.total, `${name}: passed ${axis.passed} exceeds total ${axis.total}`);
  }
}

test('INV1: unparsable package.json with has_npm_package true cannot yield a perfect npm axis', async () => {
  const dir = makeRepo({
    'package.json': '{ broken json',
    '.discoverability/project.yml': 'project:\n  name: phantom-npm\nartifacts:\n  has_npm_package: true\n',
  });
  try {
    const report = await audit(dir, { online: false });
    assert.equal(report.environment.has_npm_package, true);

    const finding = report.findings.find((f) => f.id === 'npm.package_invalid');
    assert.ok(finding, 'expected an npm.package_invalid finding');
    assert.equal(finding.severity, 'error');
    assert.match(finding.title, /missing or unparsable/);

    const npm = report.score.axes.npm;
    assert.equal(npm.applicable, true);
    assert.equal(npm.total, 1);
    assert.equal(npm.passed, 0);
    assert.equal(npm.score, 0);
    assert.ok(report.summary.errors >= 1);
    assertTallyInvariants(report);
  } finally {
    removeRepo(dir);
  }
});

test('INV1: a claimed npm package with no package.json at all is also flagged', async () => {
  const dir = makeRepo({
    '.discoverability/project.yml': 'project:\n  name: phantom-npm\nartifacts:\n  has_npm_package: true\n',
  });
  try {
    const report = await audit(dir, { online: false });
    const finding = report.findings.find((f) => f.id === 'npm.package_invalid');
    assert.ok(finding, 'expected an npm.package_invalid finding when package.json is absent');
    assert.equal(finding.severity, 'error');
    assert.equal(report.score.axes.npm.score, 0);
    assertTallyInvariants(report);
  } finally {
    removeRepo(dir);
  }
});

test('INV2: a README-less repo skips readme checks instead of passing them', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'no-readme', description: 'No readme repo', version: '1.0.0' }),
  });
  try {
    const report = await audit(dir, { online: false });
    const readme = report.score.axes.readme;
    assert.equal(readme.total, 1, 'only readme.exists may run without a README');
    assert.equal(readme.passed, 0);
    assert.equal(readme.score, 0);

    const missing = report.findings.filter((f) => f.title === 'README.md is missing');
    assert.equal(missing.length, 1);
    assert.equal(missing[0].id, 'readme.exists');

    assert.ok(report.summary.checks < 35, 'skipped checks must not be counted as run');
    assertTallyInvariants(report);
  } finally {
    removeRepo(dir);
  }
});

test('INV2: an axis whose checks all skipped renormalises out of the score', () => {
  const score = computeScore({ readme: { passed: 0, total: 0 }, hygiene: { passed: 9, total: 9 } }, ['readme', 'hygiene']);
  assert.equal(score.axes.readme.applicable, false);
  assert.equal(score.axes.readme.score, 0);
  assert.equal(score.total, 100);
});

test('INV3: offline github checks never error on state they cannot observe', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'offline-gh', version: '1.0.0' }),
  });
  try {
    const report = await audit(dir, { online: false });
    assert.equal(report.environment.offline, true);

    const githubErrors = report.findings.filter((f) => f.axis === 'github' && f.severity === 'error');
    assert.deepEqual(githubErrors, []);

    const description = report.findings.find((f) => f.id === 'github.description');
    assert.ok(description, 'the unobservable description must surface as info');
    assert.equal(description.severity, 'info');
    assert.match(description.title, /offline mode/);

    const topics = report.findings.find((f) => f.id === 'github.topics_count');
    assert.ok(topics, 'the unobservable topics must surface as info');
    assert.equal(topics.severity, 'info');
    assert.match(topics.title, /offline mode/);
  } finally {
    removeRepo(dir);
  }
});

test('INV3: config-provided github values keep config-based validation offline', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'cfg-gh', version: '1.0.0' }),
    '.discoverability/project.yml': [
      'project:',
      '  name: cfg-gh',
      '  one_liner: A configured one liner for the project',
      'keywords:',
      '  github_topics:',
      '    - cli',
      '    - tools',
      '    - demo',
      'links:',
      '  homepage: https://example.com/cfg-gh',
      '',
    ].join('\n'),
  });
  try {
    const report = await audit(dir, { online: false });
    assert.equal(report.findings.find((f) => f.id === 'github.description'), undefined, 'a valid configured one_liner passes offline');
    const topics = report.findings.find((f) => f.id === 'github.topics_count');
    assert.ok(topics, '3 configured topics must still be validated');
    assert.equal(topics.severity, 'warn');
    assert.match(topics.title, /Only 3 GitHub topics/);
  } finally {
    removeRepo(dir);
  }
});

test('INV3: an observed empty description and topic set online stay errors', () => {
  const ctx = {
    github: { available: true, description: null, topics: [], homepageUrl: null },
    config: { project: {}, keywords: {}, links: {} },
  };
  const description = githubChecks.find((c) => c.id === 'github.description').run(ctx);
  assert.equal(description.severity, 'error');
  assert.match(description.title, /No repository description found/);

  const topics = githubChecks.find((c) => c.id === 'github.topics_count').run(ctx);
  assert.equal(topics.severity, 'error');
  assert.match(topics.title, /No GitHub topics configured/);
});

test('INV4: info findings are advisory and do not decrement the pass tally', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'info-tolerance',
      version: '0.0.1',
      description: 'A package with complete metadata but a pre-1.0 version',
      keywords: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      repository: { url: 'git+https://github.com/example/info-tolerance.git' },
      homepage: 'https://example.com/info-tolerance',
      bugs: { url: 'https://example.com/info-tolerance/issues' },
      exports: { '.': { import: './index.js', require: './index.cjs', types: './index.d.ts' } },
      types: './index.d.ts',
      sideEffects: false,
      files: ['index.js', 'index.cjs', 'index.d.ts'],
      engines: { node: '>=18' },
      scripts: { test: 'node --test' },
    }),
    'index.js': 'export const x = 1;\n',
  });
  try {
    const report = await audit(dir, { online: false });
    const preRelease = report.findings.find((f) => f.id === 'npm.version_stability');
    assert.ok(preRelease, 'expected the pre-1.0 info finding');
    assert.equal(preRelease.severity, 'info');

    const npm = report.score.axes.npm;
    assert.equal(npm.total, 10);
    assert.equal(npm.passed, 10);
    assert.equal(npm.score, 100);
    assert.ok(report.summary.info >= 1);
    assertTallyInvariants(report);
  } finally {
    removeRepo(dir);
  }
});
