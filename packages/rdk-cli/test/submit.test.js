import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { submitCommand, insertEntryIntoReadme } from '../src/commands/submit.js';
import { loadConfig } from '../src/config.js';
import { makeRepo, removeRepo } from './helpers.js';

const PROJECT_YML = `project:\n  name: "demo-project"\n  one_liner: "A demo project for submit tests."\n`;

const LIST_README = [
  '# Awesome demo',
  '',
  '## Tools',
  '',
  '- [Alpha](https://github.com/a/alpha) — First.',
  '- [Beta](https://github.com/a/beta) — Second.',
  '',
  '## Other',
  '',
  '- [Gamma](https://github.com/a/gamma) — Third.',
  '',
].join('\n');

function repo() {
  const dir = makeRepo({ '.discoverability/project.yml': PROJECT_YML });
  return { dir, config: loadConfig(dir).config };
}

function ghStub(overrides = {}) {
  return (args) => {
    if (args[0] === '--version') return { ok: true, stdout: 'gh version 9.9.9\n', stderr: '', code: 0 };
    const handler = overrides[`${args[0]} ${args[1]}`] || overrides.default;
    return handler ? handler(args) : { ok: false, stdout: '', stderr: 'stubbed failure', code: 1 };
  };
}

function gitStub({ onClone, onAdd } = {}) {
  return (args) => {
    if (args[0] === 'clone') {
      if (onClone) onClone(args[3]);
      return { ok: true, stdout: '', stderr: '', code: 0 };
    }
    if (args[2] === 'add' && onAdd) onAdd(args[1]);
    return { ok: true, stdout: '', stderr: '', code: 0 };
  };
}

test('insertEntryIntoReadme appends at the end of the matched section', () => {
  const entry = '- [Zeta](https://github.com/a/zeta) — New.';
  const result = insertEntryIntoReadme(LIST_README, 'Tools', entry);
  assert.equal(result.ok, true);
  const tools = result.readme.split('## Other')[0];
  assert.match(tools, /\[Beta\][^\n]*\n- \[Zeta\]/);
  assert.doesNotMatch(result.readme.split('## Other')[1], /Zeta/);
});

test('insertEntryIntoReadme places alphabetically between neighbours', () => {
  const entry = '- [Awesome](https://github.com/a/awesome) — New.';
  const result = insertEntryIntoReadme(LIST_README, 'Tools', entry, 'alphabetical');
  assert.equal(result.ok, true);
  const tools = result.readme.split('## Other')[0];
  assert.match(tools, /\[Alpha\][^\n]*\n- \[Awesome\][^\n]*\n- \[Beta\]/);
});

test('insertEntryIntoReadme rejects an unknown category and a duplicate name', () => {
  const missing = insertEntryIntoReadme(LIST_README, 'Nonexistent', '- [X](u) — X.');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);
  const duplicate = insertEntryIntoReadme(LIST_README, 'Tools', '- [Alpha](https://github.com/a/other) — X.', 'alphabetical');
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /already exists/);
});

test('submit refuses --apply without the acknowledgement, reason and plan digest', async () => {
  const { dir, config } = repo();
  try {
    const noAck = await submitCommand({ cwd: dir, options: { apply: true, targets: 'a/b', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.equal(noAck.ok, false);
    assert.match(noAck.error, /--ack/);

    const noReason = await submitCommand({ cwd: dir, options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', targets: 'a/b', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.equal(noReason.ok, false);
    assert.match(noReason.output, /--reason/);

    const noDigest = await submitCommand({ cwd: dir, options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test', targets: 'a/b', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.equal(noDigest.ok, false);
    assert.equal(noDigest.code, 'plan_digest_required');
    assert.match(noDigest.error, /plan-digest/);
  } finally {
    removeRepo(dir);
  }
});

test('submit previews offline with a digest and never touches gh or git', async () => {
  const { dir, config } = repo();
  try {
    const boom = () => {
      throw new Error('runner must not be called in preview');
    };
    const result = await submitCommand({
      cwd: dir,
      options: { targets: 'owner/list', category: 'Tools', position: 'alphabetical', repo: 'owner/demo' },
      config,
      ghRunner: boom,
      gitRunner: boom,
    });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /- \[demo-project\]\(https:\/\/github\.com\/owner\/demo\) — A demo project for submit tests\./);
    assert.match(result.output, /rdk\/list\/add-demo-project/);
    assert.match(result.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(result.output, /Dry run/);
    assert.equal(result.applied.length, 0);
  } finally {
    removeRepo(dir);
  }
});

test('submit skips targets that already have a recorded submission', async () => {
  const { dir, config } = repo();
  try {
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), JSON.stringify([
      { target: 'owner/list', pr_url: 'https://github.com/owner/list/pull/1', status: 'open' },
    ]));
    const result = await submitCommand({
      cwd: dir,
      options: { targets: 'owner/list,other/list2', category: 'Tools', repo: 'owner/demo' },
      config,
      ghRunner: ghStub(),
      gitRunner: gitStub(),
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /owner\/list: skipped, a open submission is already recorded/);
    assert.deepEqual(result.plan.map((item) => item.target), ['other/list2']);
  } finally {
    removeRepo(dir);
  }
});

test('submit --apply opens the PR and records it in the ledger', async () => {
  const { dir, config } = repo();
  let committed = null;
  try {
    const gh = ghStub({
      'api user': () => ({ ok: true, stdout: 'WhiteBite\n', stderr: '', code: 0 }),
      'repo fork': () => ({ ok: true, stdout: '✓ Created fork WhiteBite/list\n', stderr: '', code: 0 }),
      'pr list': () => ({ ok: true, stdout: '[]', stderr: '', code: 0 }),
      'pr create': () => ({ ok: true, stdout: 'https://github.com/owner/list/pull/42\n', stderr: '', code: 0 }),
    });
    const git = gitStub({
      onClone: (work) => {
        mkdirSync(work, { recursive: true });
        writeFileSync(join(work, 'README.md'), LIST_README);
      },
      onAdd: (work) => {
        committed = readFileSync(join(work, 'README.md'), 'utf8');
      },
    });
    const preview = await submitCommand({ cwd: dir, options: { targets: 'owner/list', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: gh, gitRunner: git });
    const result = await submitCommand({
      cwd: dir,
      options: {
        apply: true,
        ack: 'I_ACK_RDK_GITHUB_WRITE',
        reason: 'unit test submission',
        plan_digest: preview.plan_digest,
        targets: 'owner/list',
        category: 'Tools',
        repo: 'owner/demo',
      },
      config,
      ghRunner: gh,
      gitRunner: git,
    });
    assert.equal(result.ok, true, result.output);
    assert.match(result.output, /✅ https:\/\/github\.com\/owner\/list\/pull\/42/);
    assert.equal(result.applied.length, 1);
    assert.deepEqual(
      { ...result.applied[0], submitted_at: 'ts' },
      {
        target: 'owner/list',
        pr_url: 'https://github.com/owner/list/pull/42',
        branch: 'rdk/list/add-demo-project',
        fork: 'WhiteBite/list',
        submitted_at: 'ts',
        status: 'open',
        channel: 'awesome-list',
        mechanism: 'git-pr',
        artifact: 'readme-row',
        dedupe_key: 'awesome-list:owner/list',
      },
    );
    assert.match(committed, /- \[demo-project\]\(https:\/\/github\.com\/owner\/demo\) — A demo project for submit tests\./);
    const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].status, 'open');
  } finally {
    removeRepo(dir);
  }
});

test('submit --apply updates an existing PR and replaces the ledger row instead of duplicating it', async () => {
  const { dir, config } = repo();
  try {
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), JSON.stringify([
      { target: 'owner/list', channel: 'awesome-list', dedupe_key: 'awesome-list:owner/list', pr_url: 'https://github.com/owner/list/pull/9', status: 'needs_changes' },
    ]));
    const gh = ghStub({
      'api user': () => ({ ok: true, stdout: 'WhiteBite\n', stderr: '', code: 0 }),
      'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
      'pr list': () => ({ ok: true, stdout: JSON.stringify([{ url: 'https://github.com/owner/list/pull/9', state: 'OPEN' }]), stderr: '', code: 0 }),
    });
    const readme = LIST_README.replace(
      '- [Beta](https://github.com/a/beta) — Second.',
      '- [Beta](https://github.com/a/beta) — Second.\n- [demo-project](https://github.com/owner/demo) — Old one-liner.',
    );
    const git = gitStub({ onClone: (work) => { mkdirSync(work, { recursive: true }); writeFileSync(join(work, 'README.md'), readme); } });
    const preview = await submitCommand({ cwd: dir, options: { targets: 'owner/list', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: gh, gitRunner: git });
    const result = await submitCommand({
      cwd: dir,
      options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test update', plan_digest: preview.plan_digest, targets: 'owner/list', category: 'Tools', repo: 'owner/demo' },
      config,
      ghRunner: gh,
      gitRunner: git,
    });
    assert.equal(result.ok, true, result.output);
    assert.match(result.output, /✅ updated https:\/\/github\.com\/owner\/list\/pull\/9/);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].updated, true);
    const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].status, 'open');
    assert.equal(ledger[0].pr_url, 'https://github.com/owner/list/pull/9');
    assert.equal(ledger[0].dedupe_key, 'awesome-list:owner/list');
    assert.equal(ledger[0].updated, undefined);
  } finally {
    removeRepo(dir);
  }
});

test('submit --apply retrying after a closed PR replaces the stale ledger row instead of duplicating it', async () => {
  const { dir, config } = repo();
  try {
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), JSON.stringify([
      { target: 'owner/list', channel: 'awesome-list', dedupe_key: 'awesome-list:owner/list', pr_url: 'https://github.com/owner/list/pull/9', status: 'closed' },
    ]));
    const gh = ghStub({
      'api user': () => ({ ok: true, stdout: 'WhiteBite\n', stderr: '', code: 0 }),
      'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
      'pr list': () => ({ ok: true, stdout: JSON.stringify([{ url: 'https://github.com/owner/list/pull/9', state: 'CLOSED' }]), stderr: '', code: 0 }),
      'pr create': () => ({ ok: true, stdout: 'https://github.com/owner/list/pull/44\n', stderr: '', code: 0 }),
    });
    const git = gitStub({ onClone: (work) => { mkdirSync(work, { recursive: true }); writeFileSync(join(work, 'README.md'), LIST_README); } });
    const preview = await submitCommand({ cwd: dir, options: { targets: 'owner/list', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: gh, gitRunner: git });
    const result = await submitCommand({
      cwd: dir,
      options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test retry', plan_digest: preview.plan_digest, targets: 'owner/list', category: 'Tools', repo: 'owner/demo' },
      config,
      ghRunner: gh,
      gitRunner: git,
    });
    assert.equal(result.ok, true, result.output);
    const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
    assert.equal(ledger.length, 1, 'the retry must replace the stale closed row, not append a second one');
    assert.equal(ledger[0].status, 'open');
    assert.equal(ledger[0].pr_url, 'https://github.com/owner/list/pull/44');
    assert.equal(ledger[0].dedupe_key, 'awesome-list:owner/list');
  } finally {
    removeRepo(dir);
  }
});

test('submit --apply refuses a stale plan digest', async () => {
  const { dir, config } = repo();
  try {
    const result = await submitCommand({
      cwd: dir,
      options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test', plan_digest: 'deadbeef', targets: 'owner/list', category: 'Tools', repo: 'owner/demo' },
      config,
      ghRunner: ghStub(),
      gitRunner: gitStub(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'plan_digest_mismatch');
  } finally {
    removeRepo(dir);
  }
});

test('submit reports an unparsable ledger instead of repairing it', async () => {
  const { dir, config } = repo();
  try {
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), '{ not json');
    const result = await submitCommand({ cwd: dir, options: { targets: 'owner/list', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.equal(result.ok, false);
    assert.match(result.error, /parse/);
  } finally {
    removeRepo(dir);
  }
});

test('submit --search needs gh and lists candidates when it answers', async () => {
  const { dir, config } = repo();
  try {
    const offline = await submitCommand({ cwd: dir, options: { search: true }, config, ghRunner: ghStub() });
    assert.equal(offline.ok, false);
    assert.match(offline.error, /gh/);

    const gh = ghStub({
      'search repos': () => ({
        ok: true,
        stdout: JSON.stringify([{ fullName: 'owner/awesome-demo', stargazersCount: 12, description: 'A demo list.' }]),
        stderr: '',
        code: 0,
      }),
    });
    const online = await submitCommand({ cwd: dir, options: { search: true }, config, ghRunner: gh });
    assert.equal(online.ok, true);
    assert.match(online.output, /owner\/awesome-demo/);
    assert.match(online.output, /--targets/);
  } finally {
    removeRepo(dir);
  }
});

test('submit demands targets, a valid format and a category before anything else', async () => {
  const { dir, config } = repo();
  try {
    const noTargets = await submitCommand({ cwd: dir, options: {}, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.match(noTargets.error, /no targets/i);

    const badTarget = await submitCommand({ cwd: dir, options: { targets: 'not-a-slug', category: 'Tools' }, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.match(badTarget.error, /invalid target/i);

    const noCategory = await submitCommand({ cwd: dir, options: { targets: 'owner/list' }, config, ghRunner: ghStub(), gitRunner: gitStub() });
    assert.match(noCategory.error, /category is required/i);
  } finally {
    removeRepo(dir);
  }
});

test('submit detects a target that already lists the project', async () => {
  const { dir, config } = repo();
  try {
    const readme = LIST_README.replace('- [Beta](https://github.com/a/beta) — Second.', '- [Beta](https://github.com/a/beta) — Second.\n- [demo-project](https://github.com/owner/demo) — Already there.');
    const gh = ghStub({
      'api user': () => ({ ok: true, stdout: 'WhiteBite\n', stderr: '', code: 0 }),
      'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
      'pr list': () => ({ ok: true, stdout: '[]', stderr: '', code: 0 }),
    });
    const preview = await submitCommand({ cwd: dir, options: { targets: 'owner/list', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: gh, gitRunner: gitStub() });
    const result = await submitCommand({
      cwd: dir,
      options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test', plan_digest: preview.plan_digest, targets: 'owner/list', category: 'Tools', repo: 'owner/demo' },
      config,
      ghRunner: gh,
      gitRunner: gitStub({ onClone: (work) => { mkdirSync(work, { recursive: true }); writeFileSync(join(work, 'README.md'), readme); } }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /already lists/);
    assert.equal(result.applied.length, 0);
    assert.equal(existsSync(join(dir, '.discoverability', 'submissions.json')), false, 'a refused submission must not touch the ledger');
  } finally {
    removeRepo(dir);
  }
});

test('rmSync cleanup: a failed clone leaves no ledger entry', async () => {
  const { dir, config } = repo();
  try {
    const gh = ghStub({
      'api user': () => ({ ok: true, stdout: 'WhiteBite\n', stderr: '', code: 0 }),
      'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
      'pr list': () => ({ ok: true, stdout: '[]', stderr: '', code: 0 }),
    });
    const preview = await submitCommand({ cwd: dir, options: { targets: 'owner/list', category: 'Tools', repo: 'owner/demo' }, config, ghRunner: gh, gitRunner: gitStub() });
    const result = await submitCommand({
      cwd: dir,
      options: { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test', plan_digest: preview.plan_digest, targets: 'owner/list', category: 'Tools', repo: 'owner/demo' },
      config,
      ghRunner: gh,
      gitRunner: () => ({ ok: false, stdout: '', stderr: 'network down', code: 128 }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /failed to clone/);
    assert.equal(result.applied.length, 0);
  } finally {
    removeRepo(dir);
  }
});
