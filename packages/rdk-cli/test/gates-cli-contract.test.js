import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, removeRepo } from './helpers.js';
import { parseArgs } from '../src/cli.js';
import { DEFAULT_ACK, githubSyncCommand } from '../src/commands/githubSync.js';
import { loadConfig } from '../src/config.js';
import { listFiles } from '../src/util/fs.js';

const HERE = fileURLToPath(import.meta.url);
const CLI = join(HERE, '..', '..', 'bin', 'rdk.js');
const CLI_SRC = readFileSync(join(HERE, '..', '..', 'src', 'cli.js'), 'utf8');
const PKG = { name: 'flag-demo', version: '1.0.0', description: 'Flag behaviour demo package' };
const COMPLETE_PKG = {
  name: 'surface-demo',
  version: '0.0.1',
  description: 'npm surface demo',
  main: 'index.js',
  repository: { type: 'git', url: 'git+https://example.com/surface-demo.git' },
  keywords: ['a', 'b', 'c', 'd', 'e'],
  engines: { node: '>=18' },
  files: ['index.js'],
  scripts: { test: 'node --test' },
};

function rdk(args, cwd, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', ...options });
}

async function withRepo(files, fn) {
  const dir = makeRepo(files);
  try {
    await fn(dir);
  } finally {
    removeRepo(dir);
  }
}

function snapshotTree(dir) {
  const out = {};
  for (const path of listFiles(dir, { recursive: true })) {
    out[relative(dir, path)] = readFileSync(path, 'utf8');
  }
  return out;
}

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

// USAGE is a non-exported template literal; escaped backticks are stripped so it ends at the real closer
function usageText() {
  const match = /const USAGE = `([\s\S]*?)`;/.exec(CLI_SRC.replace(/\\`/g, ''));
  assert.ok(match, 'USAGE template literal not found in src/cli.js');
  return match[1];
}

function usageFlags() {
  return [...new Set(usageText().match(/--([a-z][a-z0-9-]*)/g) || [])];
}

// a stub npm on PATH keeps the --list proof offline: no real npm pack spawn
function makeNpmShim() {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-npm-shim-'));
  writeFileSync(join(dir, 'pack.json'), JSON.stringify([{
    name: 'shim-pkg',
    version: '1.0.0',
    files: [{ path: 'README.md', size: 42, mode: 420 }],
    unpackedSize: 1024,
  }]));
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'npm.cmd'), '@echo off\r\ntype "%~dp0pack.json"\r\n');
  } else {
    const script = join(dir, 'npm');
    writeFileSync(script, '#!/bin/sh\ncat "$(dirname "$0")/pack.json"\n');
    chmodSync(script, 0o755);
  }
  return dir;
}

function envWithPrependedPath(dir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env.PATH = `${dir}${delimiter}${process.env.PATH || ''}`;
  return env;
}

const BEHAVIOUR = {
  '--format': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const json = rdk(['audit', '--format', 'json'], dir);
      assert.equal(json.status, 0, json.stderr);
      assert.equal(JSON.parse(json.stdout).schema, 'rdk-audit/1');
      const markdown = rdk(['audit', '--format', 'markdown'], dir);
      assert.equal(markdown.status, 0, markdown.stderr);
      assert.notEqual(markdown.stdout, json.stdout, 'json and markdown output must differ');
    });
  },

  '--out': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const result = rdk(['audit', '--out', 'report.md'], dir);
      assert.equal(result.status, 0, result.stderr);
      const written = readFileSync(join(dir, 'report.md'), 'utf8');
      assert.ok(written.length > 0, '--out must write the report file');
      assert.ok(result.stdout.startsWith(written), '--out file content must match the stdout report');
    });
  },

  '--online': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const online = rdk(['audit', '--online', '--format', 'json'], dir);
      assert.equal(online.status, 0, online.stderr);
      assert.equal(JSON.parse(online.stdout).environment.offline, false);
      const offline = rdk(['audit', '--format', 'json'], dir);
      assert.equal(JSON.parse(offline.stdout).environment.offline, true);
    });
  },

  '--no-github': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const skipped = rdk(['audit', '--online', '--no-github', '--format', 'json'], dir);
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.equal(JSON.parse(skipped.stdout).environment.github_source, 'offline mode (pass --online to query GitHub)');
      const online = rdk(['audit', '--online', '--format', 'json'], dir);
      assert.equal(JSON.parse(online.stdout).environment.github_source, 'no GitHub remote detected');
    });
  },

  '--min-score': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const below = rdk(['audit', '--min-score', '100'], dir);
      assert.equal(below.status, 2, below.stdout + below.stderr);
      assert.match(below.stderr, /score: \d+\/100/);
      const above = rdk(['audit', '--min-score', '0'], dir);
      assert.equal(above.status, 0, above.stderr);
      const invalid = rdk(['audit', '--min-score', 'abc'], dir);
      assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
      assert.match(invalid.stderr, /--min-score must be a number/);
    });
  },

  '--quiet': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const result = rdk(['audit', '--quiet'], dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '', '--quiet must leave stdout empty');
      assert.match(result.stderr, /score: \d+\/100/);
    });
  },

  '--no-pack': async () => {
    await withRepo({ 'package.json': JSON.stringify(COMPLETE_PKG) }, async (dir) => {
      const result = rdk(['npm-surface', '--no-pack'], dir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /## Publishability/);
      assert.doesNotMatch(result.stdout, /## Tarball/, '--no-pack must skip the tarball section');
    });
  },

  '--list': async () => {
    const shim = makeNpmShim();
    try {
      await withRepo({ 'package.json': JSON.stringify(COMPLETE_PKG) }, async (dir) => {
        const withList = rdk(['npm-surface', '--list'], dir, { env: envWithPrependedPath(shim) });
        assert.equal(withList.status, 0, withList.stdout + withList.stderr);
        assert.match(withList.stdout, /tarball contents/, '--list must render the tarball contents block');
        const withoutList = rdk(['npm-surface'], dir, { env: envWithPrependedPath(shim) });
        assert.equal(withoutList.status, 0, withoutList.stdout + withoutList.stderr);
        assert.match(withoutList.stdout, /## Tarball/);
        assert.doesNotMatch(withoutList.stdout, /tarball contents/);
      });
    } finally {
      removeRepo(shim);
    }
  },

  '--dry-run': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const before = snapshotTree(dir);
      const result = rdk(['fix', '--dry-run'], dir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Dry run/);
      assert.deepEqual(snapshotTree(dir), before, 'fix --dry-run must not write anything');
    });
  },

  '--apply': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const first = rdk(['fix', '--apply'], dir);
      assert.equal(first.status, 0, first.stdout + first.stderr);
      assert.ok(existsSync(join(dir, 'README.md')), '--apply must write the scaffolded files');
      const afterFirst = snapshotTree(dir);
      const second = rdk(['fix', '--apply'], dir);
      assert.equal(second.status, 0, second.stdout + second.stderr);
      assert.match(second.stdout, /No safe autofixes/);
      assert.deepEqual(snapshotTree(dir), afterFirst, 'a second --apply must converge with no writes');
    });
  },

  '--only': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const restricted = rdk(['fix', '--only', 'license.stub'], dir);
      assert.equal(restricted.status, 0, restricted.stdout + restricted.stderr);
      assert.match(restricted.stdout, /license\.stub/);
      assert.doesNotMatch(restricted.stdout, /readme\.generate/, '--only must restrict the plan to the requested patch');
      const full = rdk(['fix'], dir);
      assert.match(full.stdout, /readme\.generate/);
    });
  },

  '--skip': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const skipped = rdk(['fix', '--skip', 'license.stub'], dir);
      assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
      assert.doesNotMatch(skipped.stdout, /license\.stub/, '--skip must exclude the requested patch');
      const full = rdk(['fix'], dir);
      assert.match(full.stdout, /license\.stub/);
    });
  },

  '--ack': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const result = rdk(['github-sync', '--apply'], dir);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Refusing to write: --ack/);
    });
  },

  '--reason': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const result = rdk(['github-sync', '--apply', '--ack', DEFAULT_ACK], dir);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Refusing to write: pass --reason/);
    });
  },

  '--plan-digest': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const result = rdk(['github-sync', '--apply', '--ack', DEFAULT_ACK, '--reason', 'gate contract proof'], dir);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /--plan-digest is required/);
    });
  },

  '--project': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const project = rdk(['skill', 'status', '--project'], dir);
      assert.equal(project.status, 0, project.stdout + project.stderr);
      assert.ok(project.stdout.includes(join(dir, '.opencode', 'skills')), '--project must target repo-local skill dirs');
      const global = rdk(['skill', 'status'], dir);
      assert.ok(global.stdout.includes(join(homedir(), '.config', 'opencode', 'skills')));
      assert.ok(!global.stdout.includes(join(dir, '.opencode', 'skills')));
    });
  },

  '--cwd': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const result = rdk(['audit', '--format', 'json', '--cwd', dir], process.cwd());
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).project.name, PKG.name, '--cwd must audit the target directory');
    });
  },

  '--repo': async () => {
    assert.equal(parseArgs(['github-sync', '--repo', 'owner/name']).flags.repo, 'owner/name');
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const calls = [];
      const ghRunner = (args) => {
        calls.push(args);
        if (args[0] === '--version') return { ok: true, stdout: 'gh version 9.9.9\n', stderr: '', code: 0 };
        return { ok: false, stdout: '', stderr: 'stubbed failure', code: 1 };
      };
      const result = await githubSyncCommand({
        cwd: dir,
        options: { repo: 'owner/name' },
        config: loadConfig(dir).config,
        ghRunner,
      });
      assert.ok(calls.some((args) => args.includes('owner/name')), '--repo must reach the gh repo view call');
      assert.equal(result.exitCode, 1);
    });
  },

  '--secrets-depth': async () => {
    await withRepo({ 'package.json': JSON.stringify(PKG) }, async (dir) => {
      const identity = ['-c', 'user.email=rdk@example.com', '-c', 'user.name=rdk-gate', '-c', 'commit.gpgsign=false'];
      git(dir, ['init']);
      git(dir, ['add', 'package.json']);
      git(dir, [...identity, 'commit', '-m', 'leak ghp_0123456789abcdef in history']);
      writeFileSync(join(dir, 'NOTES.md'), 'notes\n');
      git(dir, ['add', 'NOTES.md']);
      git(dir, [...identity, 'commit', '-m', 'chore: add notes']);
      const deep = rdk(['audit', '--format', 'json'], dir);
      assert.equal(deep.status, 0, deep.stderr);
      assert.ok(
        JSON.parse(deep.stdout).findings.some((f) => f.id === 'hygiene.secrets_heuristic'),
        'default depth must scan the leaky commit',
      );
      const shallow = rdk(['audit', '--format', 'json', '--secrets-depth', '1'], dir);
      assert.equal(shallow.status, 0, shallow.stderr);
      assert.ok(
        !JSON.parse(shallow.stdout).findings.some((f) => f.id === 'hygiene.secrets_heuristic'),
        '--secrets-depth 1 must skip the older leaky commit',
      );
    });
  },

  '--help': async () => {
    const result = rdk(['--help'], process.cwd());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /rdk — Repo Discoverability Kit/);
  },

  '--version': async () => {
    const result = rdk(['--version'], process.cwd());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\d+\.\d+\.\d+/);
  },
};

test('USAGE contract: every documented flag has a behaviour proof', () => {
  const flags = usageFlags();
  assert.ok(flags.length >= 15, `USAGE flag extraction found only ${flags.length} flags; the extraction is broken`);
  const missing = flags.filter((flag) => !Object.hasOwn(BEHAVIOUR, flag));
  assert.deepEqual(
    missing,
    [],
    `USAGE documents flags with no behaviour entry: ${missing.join(', ')} — add a BEHAVIOUR proof or drop the flag from USAGE`,
  );
  for (const [flag, behaviour] of Object.entries(BEHAVIOUR)) {
    assert.equal(typeof behaviour, 'function', `BEHAVIOUR['${flag}'] must be a function`);
  }
});

for (const [flag, behaviour] of Object.entries(BEHAVIOUR)) {
  test(`USAGE flag ${flag} has observable behaviour`, behaviour);
}
