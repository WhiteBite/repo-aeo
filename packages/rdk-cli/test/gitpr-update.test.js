import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execute, removeEntryByUrl } from '../src/distribution/mechanisms/gitPr.js';

const BASE_README = [
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

const PR_BRANCH_README = BASE_README.replace(
  '- [Beta](https://github.com/a/beta) — Second.',
  '- [Beta](https://github.com/a/beta) — Second.\n- [demo-project](https://github.com/owner/demo) — Old one-liner.',
);

const ITEM = {
  target: 'owner/list',
  category: 'Tools',
  position: 'end',
  entry: '- [demo-project](https://github.com/owner/demo) — A demo project for update tests.',
  title: 'Add demo-project',
  branch: 'rdk/list/add-demo-project',
  project: 'demo-project',
  url: 'https://github.com/owner/demo',
};

const OPEN_PR = { url: 'https://github.com/owner/list/pull/9' };

function ghStub(overrides = {}) {
  const calls = [];
  const stub = (args) => {
    calls.push(args);
    if (args[0] === '--version') return { ok: true, stdout: 'gh version 9.9.9\n', stderr: '', code: 0 };
    const handler = overrides[`${args[0]} ${args[1]}`] || overrides.default;
    return handler ? handler(args) : { ok: false, stdout: '', stderr: 'stubbed failure', code: 1 };
  };
  stub.calls = calls;
  return stub;
}

function gitStub({ onClone, onAdd, failStep } = {}) {
  const calls = [];
  const stub = (args) => {
    calls.push(args);
    if (args[0] === 'clone') {
      if (onClone) onClone(args[3]);
      return { ok: true, stdout: '', stderr: '', code: 0 };
    }
    if (failStep && args.includes(failStep)) return { ok: false, stdout: '', stderr: `stubbed ${failStep} failure`, code: 1 };
    if (args[2] === 'add' && onAdd) onAdd(args[1]);
    return { ok: true, stdout: '', stderr: '', code: 0 };
  };
  stub.calls = calls;
  return stub;
}

const wroteBranchReadme = (work) => {
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'README.md'), PR_BRANCH_README);
};

test('gitPr.execute pushes to the existing fork branch when an open PR matches the head branch', () => {
  const gh = ghStub({
    'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
    'pr list': () => ({ ok: true, stdout: JSON.stringify([OPEN_PR]), stderr: '', code: 0 }),
  });
  let committed = null;
  const git = gitStub({
    onClone: wroteBranchReadme,
    onAdd: (work) => {
      committed = readFileSync(join(work, 'README.md'), 'utf8');
    },
  });
  const result = execute({ item: ITEM, owner: 'WhiteBite', gh, git });
  assert.equal(result.ok, true, result.error);
  const fetches = git.calls.filter((args) => args.includes('fetch'));
  assert.deepEqual(fetches.map((args) => args.slice(2)), [['fetch', 'https://github.com/WhiteBite/list.git', `${ITEM.branch}:${ITEM.branch}`]]);
  const checkouts = git.calls.filter((args) => args.includes('checkout'));
  assert.deepEqual(checkouts.map((args) => args.slice(2)), [['checkout', ITEM.branch]]);
  const pushes = git.calls.filter((args) => args.includes('push'));
  assert.deepEqual(pushes.map((args) => args.slice(2)), [['push', 'https://github.com/WhiteBite/list.git', ITEM.branch]]);
  assert.equal(gh.calls.some((args) => args[0] === 'pr' && args[1] === 'create'), false);
  assert.equal(result.record.updated, true);
  assert.equal(result.record.pr_url, OPEN_PR.url);
  assert.doesNotMatch(committed, /Old one-liner/);
  assert.match(committed, /- \[demo-project\]\(https:\/\/github\.com\/owner\/demo\) — A demo project for update tests\./);
});

test('gitPr.execute opens a new PR when no open PR matches the branch', () => {
  const gh = ghStub({
    'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
    'pr list': () => ({ ok: true, stdout: '[]', stderr: '', code: 0 }),
    'pr create': () => ({ ok: true, stdout: 'https://github.com/owner/list/pull/42\n', stderr: '', code: 0 }),
  });
  const git = gitStub({
    onClone: (work) => {
      mkdirSync(work, { recursive: true });
      writeFileSync(join(work, 'README.md'), BASE_README);
    },
  });
  const result = execute({ item: ITEM, owner: 'WhiteBite', gh, git });
  assert.equal(result.ok, true, result.error);
  assert.equal(gh.calls.some((args) => args[0] === 'pr' && args[1] === 'create'), true);
  assert.equal(result.record.pr_url, 'https://github.com/owner/list/pull/42');
  assert.equal(result.record.updated, undefined);
});

test('gitPr.execute refuses and records nothing when the update push fails', () => {
  const gh = ghStub({
    'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
    'pr list': () => ({ ok: true, stdout: JSON.stringify([OPEN_PR]), stderr: '', code: 0 }),
  });
  const git = gitStub({ onClone: wroteBranchReadme, failStep: 'push' });
  const result = execute({ item: ITEM, owner: 'WhiteBite', gh, git });
  assert.equal(result.ok, false);
  assert.match(result.error, /git push failed/);
  assert.equal(result.record, undefined);
});

test('gitPr.execute refuses without cloning or creating when gh pr list fails', () => {
  const gh = ghStub({
    'repo fork': () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
  });
  const git = gitStub({ onClone: wroteBranchReadme });
  const result = execute({ item: ITEM, owner: 'WhiteBite', gh, git });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not check for an existing pull request/);
  assert.equal(gh.calls.some((args) => args[0] === 'pr' && args[1] === 'create'), false);
  assert.equal(git.calls.length, 0);
});

test('removeEntryByUrl removes the line for the URL and is a no-op when absent', () => {
  const removed = removeEntryByUrl(PR_BRANCH_README, 'https://github.com/owner/demo');
  assert.equal(removed.ok, true);
  assert.equal(removed.readme, BASE_README);

  const spaced = ['# H', '', '- [x](https://github.com/owner/demo) — X.', '', '- [y](https://github.com/a/y) — Y.', ''].join('\n');
  const collapsed = removeEntryByUrl(spaced, 'https://github.com/owner/demo');
  assert.equal(collapsed.ok, true);
  assert.doesNotMatch(collapsed.readme, /\n\n\n/);
  assert.match(collapsed.readme, /# H\n\n- \[y\]/);

  const absent = removeEntryByUrl(BASE_README, 'https://github.com/owner/not-there');
  assert.equal(absent.ok, true);
  assert.equal(absent.readme, BASE_README);
});
