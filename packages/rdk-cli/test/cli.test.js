import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, removeRepo } from './helpers.js';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', 'bin', 'rdk.js');

function rdk(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
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
  const result = rdk(['audit', '--min-score', '100'], process.cwd());
  assert.equal(result.status, 2);
  assert.match(result.stderr, /score: \d+\/100/);
});

test('audit --format json emits pure JSON on stdout', () => {
  const result = rdk(['audit', '--format', 'json'], process.cwd());
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'rdk-audit/1');
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
