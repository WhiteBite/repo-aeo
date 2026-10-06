import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertWriteGuards, DEFAULT_ACK, planDigest } from '../src/distribution/guard.js';
import { CHANNELS, CHANNEL_DESCRIPTOR_FIELDS, channelById, applicableChannels } from '../src/distribution/channels.js';
import { appendRecords, isBlocking, projectStatus, readLedger } from '../src/distribution/ledger.js';
import { artifactInventory, recommend } from '../src/distribution/recommend.js';
import { describe as describeGitPr, plan as planGitPr, probe as probeGitPr } from '../src/distribution/mechanisms/gitPr.js';
import { loadConfig } from '../src/config.js';
import { makeRepo, removeRepo } from './helpers.js';

const PLAN = [{ field: 'description', from: '', to: 'new text' }];

const PROJECT_YML = [
  'project:',
  '  name: "demo-project"',
  '  one_liner: "A demo project for distribution tests."',
  '  category: mcp-server',
  'artifacts:',
  '  has_docs_site: true',
  '  npm_published: true',
].join('\n');

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

test('assertWriteGuards is a no-op without apply and enforces the order ack -> reason -> digest', () => {
  assert.deepEqual(assertWriteGuards({ options: {}, config: {} }), { ok: true });
  assert.deepEqual(assertWriteGuards({ options: { apply: false, ack: 'wrong' }, config: {} }), { ok: true });

  const ack = assertWriteGuards({ options: { apply: true }, config: {} });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'ack_mismatch');
  assert.match(ack.error, /--ack/);

  const reason = assertWriteGuards({ options: { apply: true, ack: DEFAULT_ACK }, config: {} });
  assert.equal(reason.code, 'reason_required');
  assert.match(reason.error, /reason/);

  const shortReason = assertWriteGuards({ options: { apply: true, ack: DEFAULT_ACK, reason: 'abc' }, config: {} });
  assert.equal(shortReason.code, 'reason_required');

  const digest = assertWriteGuards({ options: { apply: true, ack: DEFAULT_ACK, reason: 'valid reason' }, config: {} });
  assert.equal(digest.code, 'plan_digest_required');
  assert.match(digest.error, /plan-digest/);
});

test('assertWriteGuards binds the write to the plan digest only when a plan is given', () => {
  const base = { apply: true, ack: DEFAULT_ACK, reason: 'valid reason', plan_digest: planDigest(PLAN) };
  assert.equal(assertWriteGuards({ options: base, config: {} }).ok, true);
  assert.equal(assertWriteGuards({ options: base, config: {}, plan: PLAN }).ok, true);
  assert.equal(assertWriteGuards({ options: { ...base, plan_digest: 'deadbeef' }, config: {} }).ok, true);
  const mismatch = assertWriteGuards({ options: { ...base, plan_digest: 'deadbeef' }, config: {}, plan: PLAN });
  assert.equal(mismatch.code, 'plan_digest_mismatch');
  assert.match(mismatch.error, /plan_digest mismatch/);
  assert.equal(assertWriteGuards({ options: { ...base, plan_digest: planDigest([]) }, config: {}, plan: [] }).ok, true);
});

test('assertWriteGuards honours a configured safety.ack', () => {
  const config = { safety: { ack: 'CUSTOM_ACK' } };
  assert.equal(assertWriteGuards({ options: { apply: true, ack: DEFAULT_ACK, reason: 'valid reason' }, config }).code, 'ack_mismatch');
  assert.equal(
    assertWriteGuards({ options: { apply: true, ack: 'CUSTOM_ACK', reason: 'valid reason', plan_digest: 'deadbeef' }, config, plan: PLAN }).code,
    'plan_digest_mismatch',
  );
});

test('readLedger returns [] when missing, rows when valid and null when unparsable', () => {
  const dir = makeRepo({});
  try {
    assert.deepEqual(readLedger(dir), []);
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), JSON.stringify([{ target: 'a/b' }]));
    assert.deepEqual(readLedger(dir), [{ target: 'a/b' }]);
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), '{ not json');
    assert.equal(readLedger(dir), null);
  } finally {
    removeRepo(dir);
  }
});

test('appendRecords creates and extends the ledger, and never repairs an unparsable one', () => {
  const dir = makeRepo({});
  try {
    const first = appendRecords(dir, [{ target: 'a/b', status: 'open' }]);
    assert.deepEqual(first, [{ target: 'a/b', status: 'open' }]);
    const second = appendRecords(dir, [{ target: 'c/d', status: 'submitted' }]);
    assert.deepEqual(second.map((row) => row.target), ['a/b', 'c/d']);
    assert.deepEqual(readLedger(dir), second);

    writeFileSync(join(dir, '.discoverability', 'submissions.json'), '{ not json');
    assert.equal(appendRecords(dir, [{ target: 'e/f' }]), null);
    assert.equal(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'), '{ not json');
  } finally {
    removeRepo(dir);
  }
});

test('isBlocking blocks in-flight and landed statuses and frees the terminal negatives', () => {
  for (const status of ['prepared', 'submitted', 'open', 'merged', 'listed']) {
    assert.equal(isBlocking({ status }), true, status);
  }
  for (const status of ['rejected', 'closed', 'unlisted', 'failed']) {
    assert.equal(isBlocking({ status }), false, status);
  }
  assert.equal(isBlocking({}), false);
  assert.equal(isBlocking(null), false);
});

test('projectStatus keeps the recorded status offline and maps PR states onto the machine', () => {
  const record = { status: 'open' };
  assert.equal(projectStatus(record, null), 'open');
  assert.equal(projectStatus(record, undefined), 'open');
  assert.equal(projectStatus(record, {}), 'open');
  assert.equal(projectStatus({ status: 'prepared' }, { state: 'open' }), 'submitted');
  assert.equal(projectStatus(record, { state: 'open' }), 'submitted');
  assert.equal(projectStatus(record, { state: 'merged' }), 'listed');
  assert.equal(projectStatus(record, { state: 'closed' }), 'closed');
  assert.equal(projectStatus(record, { state: 'weird' }), 'open');
  assert.equal(projectStatus({}, { state: 'merged' }), 'listed');
  assert.equal(projectStatus(null, null), null);
});

test('every channel descriptor stays within the allowed schema', () => {
  assert.equal(CHANNELS.length, 5);
  const allowed = new Set(CHANNEL_DESCRIPTOR_FIELDS);
  for (const channel of CHANNELS) {
    for (const field of Object.keys(channel)) {
      assert.ok(allowed.has(field), `${channel.id} carries the unknown field ${field}`);
    }
    assert.equal(typeof channel.id, 'string');
    assert.equal(typeof channel.mechanism, 'string');
    assert.equal(typeof channel.artifact, 'string');
    assert.ok(Array.isArray(channel.accepts) && channel.accepts.length > 0);
    assert.equal(typeof channel.summary, 'string');
    assert.equal(typeof channel.when, 'string');
    assert.equal(typeof channel.automatable, 'boolean');
    assert.equal(typeof channel.probe, 'string');
  }
});

test('channelById and applicableChannels resolve and filter by the named predicate', () => {
  assert.equal(channelById('awesome-list').mechanism, 'git-pr');
  assert.equal(channelById('does-not-exist'), null);
  const withRepo = { git_host: 'github.com', git_owner: 'owner', git_repo: 'demo' };
  assert.deepEqual(applicableChannels(withRepo).map((channel) => channel.id), ['awesome-list']);
  assert.deepEqual(applicableChannels({ git_host: null, git_owner: null, git_repo: null }), []);
  assert.deepEqual(applicableChannels({ git_host: 'github.com', git_owner: null, git_repo: 'demo' }), []);
});

test('artifactInventory derives every fact from the repository', () => {
  const dir = makeRepo({
    '.discoverability/project.yml': PROJECT_YML,
    'package.json': JSON.stringify({ name: 'demo-project', version: '1.0.0' }),
    '.github/workflows/ci.yml': 'name: ci\n',
    'skills/demo/SKILL.md': '# Demo skill\n',
  });
  try {
    git(dir, ['init']);
    git(dir, ['remote', 'add', 'origin', 'https://github.com/owner/demo-project.git']);
    assert.deepEqual(artifactInventory(loadConfig(dir)), {
      has_npm_package: true,
      has_docs_site: true,
      npm_published: true,
      has_mcp_server: true,
      has_action: true,
      has_skill: true,
      git_host: 'github.com',
      git_owner: 'owner',
      git_repo: 'demo-project',
    });
  } finally {
    removeRepo(dir);
  }
});

test('recommend marks awesome-list applicable only with a GitHub remote', () => {
  const withRemote = makeRepo({ '.discoverability/project.yml': PROJECT_YML });
  const withoutRemote = makeRepo({ '.discoverability/project.yml': PROJECT_YML });
  try {
    git(withRemote, ['init']);
    git(withRemote, ['remote', 'add', 'origin', 'git@github.com:owner/demo-project.git']);

    const yes = recommend(withRemote, loadConfig(withRemote));
    assert.equal(yes.channels.length, 5);
    assert.equal(yes.channels[0].id, 'awesome-list');
    assert.equal(yes.channels[0].applicable, true);
    assert.equal(yes.channels[0].status, 'untried');
    assert.match(yes.channels[0].next_action, /rdk submit --channel awesome-list/);

    const no = recommend(withoutRemote, loadConfig(withoutRemote));
    assert.equal(no.channels[0].applicable, false);
    assert.equal(no.channels[0].status, 'untried');
    assert.match(no.channels[0].next_action, /not applicable/);
    assert.equal(no.inventory.git_host, null);
  } finally {
    removeRepo(withRemote);
    removeRepo(withoutRemote);
  }
});

test('recommend reads the per-channel status from the ledger', () => {
  const dir = makeRepo({ '.discoverability/project.yml': PROJECT_YML });
  try {
    git(dir, ['init']);
    git(dir, ['remote', 'add', 'origin', 'https://github.com/owner/demo-project.git']);
    const loaded = loadConfig(dir);
    const ledgerPath = join(dir, '.discoverability', 'submissions.json');
    mkdirSync(join(dir, '.discoverability'), { recursive: true });

    writeFileSync(ledgerPath, JSON.stringify([
      { target: 'owner/list', channel: 'awesome-list', status: 'rejected' },
      { target: 'other/list', channel: 'awesome-list', status: 'submitted' },
    ]));
    const inFlight = recommend(dir, loaded).channels[0];
    assert.equal(inFlight.status, 'submitted');
    assert.match(inFlight.next_action, /in flight/);

    writeFileSync(ledgerPath, JSON.stringify([{ target: 'owner/list', channel: 'awesome-list', status: 'listed' }]));
    assert.match(recommend(dir, loaded).channels[0].next_action, /nothing to do/);

    writeFileSync(ledgerPath, JSON.stringify([{ target: 'owner/list', channel: 'awesome-list', status: 'rejected' }]));
    const rejected = recommend(dir, loaded).channels[0];
    assert.equal(rejected.status, 'rejected');
    assert.match(rejected.next_action, /one retry is allowed/);

    writeFileSync(ledgerPath, JSON.stringify([{ target: 'owner/list', channel: 'other-channel', status: 'submitted' }]));
    assert.equal(recommend(dir, loaded).channels[0].status, 'untried');
  } finally {
    removeRepo(dir);
  }
});

const PLAN_CTX = {
  targets: ['owner/list', 'other/list2'],
  category: 'Tools',
  position: 'alphabetical',
  entry: '- [demo](https://github.com/owner/demo) — A demo project for distribution tests.',
  name: 'demo',
  url: 'https://github.com/owner/demo',
};

test('gitPr.plan is pure and shapes each target exactly as the digest input', () => {
  const items = planGitPr(PLAN_CTX);
  assert.deepEqual(items, [
    {
      target: 'owner/list',
      category: 'Tools',
      position: 'alphabetical',
      entry: PLAN_CTX.entry,
      title: 'Add demo',
      branch: 'rdk/list/add-demo',
      project: 'demo',
      url: 'https://github.com/owner/demo',
    },
    {
      target: 'other/list2',
      category: 'Tools',
      position: 'alphabetical',
      entry: PLAN_CTX.entry,
      title: 'Add demo',
      branch: 'rdk/list2/add-demo',
      project: 'demo',
      url: 'https://github.com/owner/demo',
    },
  ]);
  assert.equal(planDigest(items), planDigest(planGitPr(PLAN_CTX)));
  assert.notEqual(planDigest(planGitPr({ ...PLAN_CTX, entry: '- [demo](https://github.com/owner/demo) — Different.' })), planDigest(items));
});

test('gitPr describe and probe expose the mechanism contract', () => {
  assert.equal(describeGitPr().id, 'git-pr');
  assert.equal(typeof describeGitPr().summary, 'string');
  assert.deepEqual(probeGitPr({ pr_url: 'https://github.com/owner/list/pull/42' }), { kind: 'gh-pr', ref: 'https://github.com/owner/list/pull/42' });
  assert.deepEqual(probeGitPr({}), { kind: 'gh-pr', ref: null });
  assert.deepEqual(probeGitPr(null), { kind: 'gh-pr', ref: null });
});
