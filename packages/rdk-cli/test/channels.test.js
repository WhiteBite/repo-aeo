import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS, channelById, applicableChannels } from '../src/distribution/channels.js';
import { recommend } from '../src/distribution/recommend.js';
import { channelsCommand } from '../src/commands/channels.js';
import { loadConfig } from '../src/config.js';
import { listFiles } from '../src/util/fs.js';
import { makeRepo, removeRepo } from './helpers.js';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', 'bin', 'rdk.js');

const PROJECT_YML = [
  'project:',
  '  name: "demo-project"',
  '  one_liner: "A demo project for distribution tests."',
  '  category: mcp-server',
  'artifacts:',
  '  has_docs_site: true',
  '  npm_published: true',
].join('\n');

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

test('the registry carries the four new channels with their mechanism config', () => {
  const registry = channelById('mcp-official-registry');
  assert.equal(registry.mechanism, 'http-json');
  assert.equal(registry.artifact, 'server.json');
  assert.deepEqual(registry.accepts, ['mcp-server']);
  assert.equal(registry.when, 'has_mcp_server');
  assert.equal(registry.automatable, true);
  assert.equal(registry.probe, 'http-search');
  assert.equal(registry.endpoint, 'https://registry.modelcontextprotocol.io/v0/servers');
  assert.equal(registry.method, 'POST');
  assert.deepEqual(registry.auth, { env: 'MCP_REGISTRY_TOKEN' });

  const form = channelById('mcp-directory-form');
  assert.equal(form.mechanism, 'web-form');
  assert.equal(form.artifact, 'form-payload');
  assert.deepEqual(form.accepts, ['mcp-server']);
  assert.equal(form.when, 'has_mcp_server');
  assert.equal(form.automatable, false);
  assert.equal(form.probe, 'none');
  assert.equal(form.formUrl, 'https://mcp.so/submit?type=server');
  assert.deepEqual(form.fields, ['name', 'url', 'description', 'category']);

  const skills = channelById('skills-sh');
  assert.equal(skills.mechanism, 'passive');
  assert.equal(skills.artifact, 'none');
  assert.deepEqual(skills.accepts, ['skill']);
  assert.equal(skills.when, 'has_skill');
  assert.equal(skills.automatable, false);
  assert.equal(skills.probe, 'crawl');
  assert.equal(skills.checkUrl, 'https://skills.sh');

  const npm = channelById('npm-registry');
  assert.equal(npm.mechanism, 'cli-publish');
  assert.equal(npm.artifact, 'npm-tarball');
  assert.deepEqual(npm.accepts, ['npm-package']);
  assert.equal(npm.when, 'has_npm_package');
  assert.equal(npm.automatable, false);
  assert.equal(npm.probe, 'registry-read');
});

test('each new channel applies only to its matching inventory', () => {
  const none = { git_host: null, git_owner: null, git_repo: null, has_mcp_server: false, has_skill: false, has_npm_package: false };
  assert.deepEqual(applicableChannels(none), []);
  assert.deepEqual(
    applicableChannels({ ...none, has_mcp_server: true }).map((channel) => channel.id),
    ['mcp-official-registry', 'mcp-directory-form'],
  );
  assert.deepEqual(applicableChannels({ ...none, has_skill: true }).map((channel) => channel.id), ['skills-sh']);
  assert.deepEqual(applicableChannels({ ...none, has_npm_package: true }).map((channel) => channel.id), ['npm-registry']);
});

test('recommend gives every channel the generic next action for untried, blocking and listed', () => {
  const dir = makeRepo({
    '.discoverability/project.yml': PROJECT_YML,
    'package.json': JSON.stringify({ name: 'demo-project', version: '1.0.0' }),
  });
  try {
    const loaded = loadConfig(dir);
    const ledgerPath = join(dir, '.discoverability', 'submissions.json');
    const mine = (result) => result.channels.find((channel) => channel.id === 'mcp-official-registry');

    const untried = mine(recommend(dir, loaded));
    assert.equal(untried.applicable, true);
    assert.equal(untried.status, 'untried');
    assert.equal(untried.next_action, 'run `rdk submit --channel mcp-official-registry` to prepare this submission');

    writeFileSync(ledgerPath, JSON.stringify([{ target: 'mcp-official-registry', channel: 'mcp-official-registry', status: 'submitted' }]));
    const blocking = mine(recommend(dir, loaded));
    assert.equal(blocking.status, 'submitted');
    assert.equal(blocking.next_action, 'a submission is in flight - see .discoverability/submissions.json');

    writeFileSync(ledgerPath, JSON.stringify([{ target: 'mcp-official-registry', channel: 'mcp-official-registry', status: 'listed' }]));
    const listed = mine(recommend(dir, loaded));
    assert.equal(listed.status, 'listed');
    assert.equal(listed.next_action, 'listed - nothing to do');
  } finally {
    removeRepo(dir);
  }
});

test('channelsCommand prints every channel with its next action and writes nothing', () => {
  const dir = makeRepo({
    '.discoverability/project.yml': PROJECT_YML,
    'package.json': JSON.stringify({ name: 'demo-project', version: '1.0.0' }),
  });
  try {
    const before = snapshotTree(dir);
    const result = channelsCommand({ cwd: dir, loaded: loadConfig(dir) });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /^# rdk channels$/m);
    for (const channel of CHANNELS) {
      assert.match(result.output, new RegExp(`^- ${channel.id} \\(${channel.mechanism}\\)$`, 'm'));
    }
    assert.equal((result.output.match(/^  next action: /gm) || []).length, CHANNELS.length);
    assert.match(result.output, /applicable:  yes/);
    assert.match(result.output, /applicable:  no/);
    assert.deepEqual(snapshotTree(dir), before, 'channels must not write anything');
  } finally {
    removeRepo(dir);
  }
});

test('rdk channels is registered, read-only and rejects stray positionals', () => {
  const dir = makeRepo({
    '.discoverability/project.yml': PROJECT_YML,
    'package.json': JSON.stringify({ name: 'demo-project', version: '1.0.0' }),
  });
  try {
    const before = snapshotTree(dir);
    const result = rdk(['channels'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^# rdk channels$/m);
    for (const channel of CHANNELS) {
      assert.ok(result.stdout.includes(channel.id), `output must mention ${channel.id}`);
    }
    assert.match(result.stdout, /next action: /);
    assert.deepEqual(snapshotTree(dir), before, 'rdk channels must not write anything');

    const stray = rdk(['channels', 'extra'], dir);
    assert.equal(stray.status, 1);
    assert.match(stray.stderr, /unexpected argument "extra" for command "channels"/);
  } finally {
    removeRepo(dir);
  }
});
