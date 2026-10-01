import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, removeRepo } from './helpers.js';
import { auditCommand } from '../src/commands/audit.js';
import { initCommand } from '../src/commands/init.js';
import { listFiles } from '../src/util/fs.js';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', 'bin', 'rdk.js');

function rdk(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

function snapshotTree(dir) {
  const out = {};
  for (const path of listFiles(dir, { recursive: true })) {
    out[relative(dir, path)] = readFileSync(path, 'utf8');
  }
  return out;
}

test('--version and --help work', () => {
  const version = rdk(['--version'], process.cwd());
  assert.equal(version.status, 0);
  assert.match(version.stdout, /\d+\.\d+\.\d+/);

  const help = rdk(['--help'], process.cwd());
  assert.equal(help.status, 0);
  assert.match(help.stdout, /rdk — Repo Discoverability Kit/);
});

test('audit exits 2 when the score is below --min-score', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'minscore', description: 'min score gate demo' }) });
  try {
    const result = rdk(['audit', '--min-score', '100'], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /score: \d+\/100/);
  } finally {
    removeRepo(dir);
  }
});

test('audit --min-score rejects non-numeric values with exit 1', () => {
  const invalid = rdk(['audit', '--min-score', 'abc'], process.cwd());
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--min-score must be a number/);

  const zero = rdk(['audit', '--min-score', '0'], process.cwd());
  assert.equal(zero.status, 0);
});

test('audit --format json emits pure JSON on stdout', () => {
  const result = rdk(['audit', '--format', 'json'], process.cwd());
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'rdk-audit/1');
});

test('audit --format rejects invalid and valueless values with exit 1', () => {
  const bogus = rdk(['audit', '--format', 'bogus'], process.cwd());
  assert.equal(bogus.status, 1);
  assert.match(bogus.stderr, /--format must be one of json\|markdown\|github-comment\|both/);
  assert.match(bogus.stderr, /got "bogus"/);

  const bare = rdk(['audit', '--format'], process.cwd());
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--format must be one of json\|markdown\|github-comment\|both/);
  assert.match(bare.stderr, /got "true"/);
});

test('auditCommand accepts every documented format and rejects a valueless --format', async () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'fmt-demo', description: 'Format demo' }) });
  try {
    const outputs = {};
    for (const format of ['json', 'markdown', 'github-comment', 'both']) {
      const result = await auditCommand({ cwd: dir, options: { format } });
      assert.equal(result.ok, true, format);
      assert.equal(result.exitCode, 0, format);
      outputs[format] = result.output;
    }
    assert.ok(outputs.json.trimStart().startsWith('{'));
    assert.ok(outputs.markdown.includes('# Discoverability audit'));
    assert.ok(outputs['github-comment'].includes('<!-- rdk-discoverability-audit -->'));
    assert.ok(outputs.both.includes('# Discoverability audit'));
    assert.ok(outputs.both.includes('<!-- rdk-discoverability-audit -->'));

    const valueless = await auditCommand({ cwd: dir, options: { format: true } });
    assert.equal(valueless.ok, false);
    assert.equal(valueless.exitCode, 1);
    assert.equal(valueless.report, null);
    assert.match(valueless.summary, /--format must be one of json\|markdown\|github-comment\|both, got "true"/);
  } finally {
    removeRepo(dir);
  }
});

test('npm-surface --format rejects invalid values with exit 1', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'ns-fmt',
      version: '0.0.1',
      description: 'format gate demo',
      main: 'index.js',
      repository: { type: 'git', url: 'git+https://example.com/ns-fmt.git' },
      keywords: ['a', 'b', 'c', 'd', 'e'],
      engines: { node: '>=18' },
      files: ['index.js'],
      scripts: { test: 'node --test' },
    }),
  });
  try {
    const bogus = rdk(['npm-surface', '--format', 'bogus', '--no-pack'], dir);
    assert.equal(bogus.status, 1);
    assert.match(bogus.stderr, /--format must be one of json\|markdown/);
    assert.match(bogus.stderr, /got "bogus"/);

    const json = rdk(['npm-surface', '--format', 'json', '--no-pack'], dir);
    assert.equal(json.status, 0, json.stdout + json.stderr);
    assert.equal(JSON.parse(json.stdout).name, 'ns-fmt');
  } finally {
    removeRepo(dir);
  }
});

test('bare rdk with no command prints usage and exits 0', () => {
  const bare = rdk([], process.cwd());
  assert.equal(bare.status, 0);
  assert.match(bare.stdout, /rdk — Repo Discoverability Kit/);
  assert.doesNotMatch(bare.stdout, /# Discoverability audit/);
  assert.doesNotMatch(bare.stderr, /score: \d+\/100/);

  const cwdOnly = rdk(['--cwd', process.cwd()], process.cwd());
  assert.equal(cwdOnly.status, 0);
  assert.match(cwdOnly.stdout, /Usage:/);

  const flagOnly = rdk(['--quiet'], process.cwd());
  assert.equal(flagOnly.status, 0);
  assert.match(flagOnly.stdout, /Usage:/);
});

test('init --apply then fix --apply raises the score on a bare repo', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'cli-demo', description: 'CLI demo project', scripts: { test: 'node --test', start: 'node .' } }) });
  try {
    const before = rdk(['audit', '--format', 'json'], dir);
    const beforeReport = JSON.parse(before.stdout);

    const init = rdk(['init', '--apply'], dir);
    assert.equal(init.status, 0, init.stdout + init.stderr);

    const afterInit = JSON.parse(rdk(['audit', '--format', 'json'], dir).stdout);
    assert.ok(afterInit.score.total > beforeReport.score.total, `expected improvement: ${beforeReport.score.total} -> ${afterInit.score.total}`);

    const fix = rdk(['fix', '--apply'], dir);
    assert.equal(fix.status, 0, fix.stdout + fix.stderr);

    const afterFix = JSON.parse(rdk(['audit', '--format', 'json'], dir).stdout);
    assert.ok(afterFix.score.total >= afterInit.score.total, `expected no regression: ${afterInit.score.total} -> ${afterFix.score.total}`);
    assert.ok(afterFix.score.total >= 60, `expected a decent score after autofix, got ${afterFix.score.total}`);
  } finally {
    removeRepo(dir);
  }
});

test('fix without --apply performs no writes', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'dry', description: 'Dry run' }) });
  try {
    const result = rdk(['fix'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Dry run/);
    assert.equal(existsSync(join(dir, 'README.md')), false);
  } finally {
    removeRepo(dir);
  }
});

test('fix --apply converges in one invocation on a fresh repo with a files array', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'converge',
      version: '0.1.0',
      description: 'Convergence scenario',
      files: ['dist'],
      scripts: { test: 'node --test' },
    }),
  });
  try {
    const first = rdk(['fix', '--apply'], dir);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /package\.files/, 'package.files must be applied in the same invocation');

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const name of ['llms.txt', 'llms-full.txt', 'AGENTS.md']) {
      assert.ok(pkg.files.includes(name), `package.json files must include ${name}`);
    }
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.match(readme, /## Quickstart/);

    const before = snapshotTree(dir);
    const second = rdk(['fix', '--apply'], dir);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /No safe autofixes/);
    assert.deepEqual(snapshotTree(dir), before);
  } finally {
    removeRepo(dir);
  }
});

test('fix dry run previews every pass, including patches that activate after files land', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'preview',
      version: '0.1.0',
      description: 'Dry run preview',
      files: ['dist'],
    }),
  });
  try {
    const result = rdk(['fix'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /across 2 passes/);
    assert.match(result.stdout, /## Pass 2/);
    assert.match(result.stdout, /package\.files/);
    assert.equal(existsSync(join(dir, 'README.md')), false, 'the dry run must not write');
  } finally {
    removeRepo(dir);
  }
});

test('github-sync refuses to write without --ack and --reason', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'sync', description: 'Sync demo' }) });
  try {
    const result = rdk(['github-sync', '--apply'], dir);
    // gh may be unavailable in the sandbox; either way it must not silently write
    assert.ok(result.status !== 0);
    assert.doesNotMatch(result.stdout + result.stderr, /updated topics/);
  } finally {
    removeRepo(dir);
  }
});

test('npm-surface reports a blocking issue for a bare package.json', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'bare', version: '0.0.1' }, null, 2) });
  try {
    const result = rdk(['npm-surface', '--no-pack'], dir);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /missing description/);
    assert.match(result.stdout, /never publishes/);
  } finally {
    removeRepo(dir);
  }
});

test('npm-surface --no-pack skips the tarball section', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'nopack',
      version: '0.0.1',
      description: 'no pack demo',
      main: 'index.js',
      repository: { type: 'git', url: 'git+https://example.com/nopack.git' },
      keywords: ['a', 'b', 'c', 'd', 'e'],
      engines: { node: '>=18' },
      files: ['index.js'],
      scripts: { test: 'node --test' },
    }),
  });
  try {
    const result = rdk(['npm-surface', '--no-pack'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /## Publishability/);
    assert.doesNotMatch(result.stdout, /## Tarball/);
  } finally {
    removeRepo(dir);
  }
});

test('auditCommand forwards github: false to the engine', async () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'fwd', description: 'forwarding demo' }) });
  try {
    const disabled = await auditCommand({ cwd: dir, options: { online: true, github: false } });
    assert.equal(disabled.report.environment.github_source, 'offline mode (pass --online to query GitHub)');

    const enabled = await auditCommand({ cwd: dir, options: { online: true } });
    assert.equal(enabled.report.environment.github_source, 'no GitHub remote detected');
  } finally {
    removeRepo(dir);
  }
});

test('audit --online --no-github skips GitHub reads', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'nogithub', description: 'no github demo' }) });
  try {
    const skipped = rdk(['audit', '--online', '--no-github', '--format', 'json'], dir);
    assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
    assert.equal(JSON.parse(skipped.stdout).environment.github_source, 'offline mode (pass --online to query GitHub)');

    const online = rdk(['audit', '--online', '--format', 'json'], dir);
    assert.equal(JSON.parse(online.stdout).environment.github_source, 'no GitHub remote detected');
  } finally {
    removeRepo(dir);
  }
});

test('init dry run returns written: [] and writes nothing', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'initdry', description: 'init dry run demo' }) });
  try {
    const result = initCommand({ cwd: dir, options: {} });
    assert.equal(result.ok, true);
    assert.deepEqual(result.written, []);
    assert.equal(existsSync(join(dir, 'README.md')), false);
  } finally {
    removeRepo(dir);
  }
});
