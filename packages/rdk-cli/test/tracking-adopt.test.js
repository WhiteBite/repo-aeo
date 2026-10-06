import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptRows, applyAdopt, discoverOwnedPrs, matchAdoptable } from '../src/distribution/tracking/adopt.js';

const SEARCH_ARGS = ['search', 'prs', '--author', '@me', '--state', 'all', '--json', 'url,repository,number,title,state,isDraft'];

function listArgs(target) {
  return ['pr', 'list', '-R', target, '--author', '@me', '--state', 'all', '--json', 'url,number,title,state,isDraft,headRefName'];
}

function ok(stdout) {
  return { ok: true, stdout, stderr: '', code: 0 };
}

test('matchAdoptable keeps only rdk/ head branches and derives target and listRepo', () => {
  const prs = [
    { url: 'https://github.com/foo/bar/pull/7', target: 'foo/bar', number: 7, state: 'OPEN', isDraft: false, headRefName: 'rdk/bar/add-my-project' },
    { url: 'https://github.com/foo/bar/pull/8', target: 'foo/bar', number: 8, state: 'CLOSED', isDraft: false, headRefName: 'feature-x' },
    { url: 'https://github.com/baz/qux/pull/9', target: 'baz/qux', number: 9, state: 'MERGED', isDraft: false },
  ];

  const rows = matchAdoptable(prs);

  assert.deepEqual(rows, [
    { url: 'https://github.com/foo/bar/pull/7', target: 'foo/bar', branch: 'rdk/bar/add-my-project', number: 7, state: 'OPEN' },
  ]);
  assert.equal(rows[0].branch.split('/')[1], rows[0].target.split('/')[1]);
});

test('matchAdoptable rejects the CI autofix branch and keeps the add convention', () => {
  const prs = [
    { url: 'https://github.com/foo/bar/pull/1', target: 'foo/bar', number: 1, state: 'OPEN', headRefName: 'rdk/autofix-2026-01-01' },
    { url: 'https://github.com/foo/bar/pull/2', target: 'foo/bar', number: 2, state: 'OPEN', headRefName: 'rdk/list/add-demo' },
  ];

  const rows = matchAdoptable(prs);

  assert.deepEqual(rows, [
    { url: 'https://github.com/foo/bar/pull/2', target: 'foo/bar', branch: 'rdk/list/add-demo', number: 2, state: 'OPEN' },
  ]);
});

test('adoptRows appends missing rows with adopted:true and skips existing pr_url/dedupe_key', () => {
  const ledger = [
    { channel: 'awesome-list', target: 'foo/bar', pr_url: 'https://github.com/foo/bar/pull/7', status: 'open', dedupe_key: 'awesome-list:foo/bar' },
    { channel: 'awesome-list', target: 'other/repo', pr_url: 'https://github.com/other/repo/pull/2', status: 'open', dedupe_key: 'awesome-list:other/repo' },
  ];
  const adoptable = [
    { url: 'https://github.com/foo/bar/pull/7', target: 'foo/bar', branch: 'rdk/bar/add-mine', number: 7, state: 'OPEN' },
    { url: 'https://github.com/foo/bar/pull/12', target: 'foo/bar', branch: 'rdk/bar/add-mine', number: 12, state: 'MERGED' },
    { url: 'https://github.com/baz/qux/pull/9', target: 'baz/qux', branch: 'rdk/qux/add-mine', number: 9, state: 'CLOSED' },
    { url: 'https://github.com/len/list/pull/15', target: 'len/list', branch: 'rdk/list/add-mine', number: 15, state: 'MERGED' },
    { url: 'https://github.com/nim/list/pull/16', target: 'nim/list', branch: 'rdk/list/add-other', number: 16, state: 'OPEN' },
  ];

  const rows = adoptRows(ledger, adoptable);

  assert.deepEqual(rows, [
    { adopted: true, channel: 'awesome-list', mechanism: 'git-pr', artifact: 'readme-row', target: 'baz/qux', branch: 'rdk/qux/add-mine', pr_url: 'https://github.com/baz/qux/pull/9', status: 'closed', dedupe_key: 'awesome-list:baz/qux' },
    { adopted: true, channel: 'awesome-list', mechanism: 'git-pr', artifact: 'readme-row', target: 'len/list', branch: 'rdk/list/add-mine', pr_url: 'https://github.com/len/list/pull/15', status: 'listed', dedupe_key: 'awesome-list:len/list' },
    { adopted: true, channel: 'awesome-list', mechanism: 'git-pr', artifact: 'readme-row', target: 'nim/list', branch: 'rdk/list/add-other', pr_url: 'https://github.com/nim/list/pull/16', status: 'open', dedupe_key: 'awesome-list:nim/list' },
  ]);
  assert.equal(ledger.length, 2);
});

test('adoptRows is idempotent across two runs', () => {
  const adoptable = [
    { url: 'https://github.com/foo/bar/pull/7', target: 'foo/bar', branch: 'rdk/bar/add-mine', number: 7, state: 'OPEN' },
    { url: 'https://github.com/baz/qux/pull/9', target: 'baz/qux', branch: 'rdk/qux/add-mine', number: 9, state: 'MERGED' },
  ];

  const first = adoptRows([], adoptable);
  assert.equal(first.length, 2);

  assert.deepEqual(adoptRows([...first], adoptable), []);
});

test('discoverOwnedPrs calls the cross-repo search then per-target pr list and merges headRefName', () => {
  const calls = [];
  const gh = (args, opts) => {
    calls.push({ args, opts });
    if (args[0] === 'search') {
      return ok(JSON.stringify([
        { url: 'https://github.com/foo/bar/pull/7', repository: { nameWithOwner: 'foo/bar' }, number: 7, title: 'Add mine', state: 'OPEN', isDraft: false },
        { url: 'https://github.com/baz/qux/pull/9', repository: { nameWithOwner: 'baz/qux' }, number: 9, title: 'Add mine', state: 'MERGED', isDraft: false },
      ]));
    }
    if (args[3] === 'foo/bar') {
      return ok(JSON.stringify([
        { url: 'https://github.com/foo/bar/pull/7', number: 7, title: 'Add mine', state: 'OPEN', isDraft: false, headRefName: 'rdk/bar/add-mine' },
      ]));
    }
    if (args[3] === 'baz/qux') {
      return ok(JSON.stringify([
        { url: 'https://github.com/baz/qux/pull/9', number: 9, title: 'Add mine', state: 'MERGED', isDraft: false, headRefName: 'rdk/qux/add-mine' },
      ]));
    }
    return ok(JSON.stringify([
      { url: 'https://github.com/other/repo/pull/2', number: 2, title: 'Add mine', state: 'CLOSED', isDraft: true, headRefName: 'feature-x' },
    ]));
  };
  const cwd = '/nowhere';

  const prs = discoverOwnedPrs({ gh, cwd, targets: ['foo/bar', 'other/repo'] });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].args, SEARCH_ARGS);
  assert.deepEqual(calls[1].args, listArgs('foo/bar'));
  assert.deepEqual(calls[2].args, listArgs('other/repo'));
  assert.deepEqual(calls[3].args, listArgs('baz/qux'));
  assert.deepEqual(calls.map((call) => call.opts), [{ cwd }, { cwd }, { cwd }, { cwd }]);
  assert.deepEqual(prs, [
    { url: 'https://github.com/foo/bar/pull/7', target: 'foo/bar', number: 7, state: 'OPEN', isDraft: false, headRefName: 'rdk/bar/add-mine' },
    { url: 'https://github.com/baz/qux/pull/9', target: 'baz/qux', number: 9, state: 'MERGED', isDraft: false, headRefName: 'rdk/qux/add-mine' },
    { url: 'https://github.com/other/repo/pull/2', target: 'other/repo', number: 2, state: 'CLOSED', isDraft: true, headRefName: 'feature-x' },
  ]);
});

test('discoverOwnedPrs lists search-discovered repos so a PR to a new target keeps headRefName', () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'search') {
      return ok(JSON.stringify([
        { url: 'https://github.com/new/list/pull/5', repository: { nameWithOwner: 'new/list' }, number: 5, title: 'Add mine', state: 'OPEN', isDraft: false },
      ]));
    }
    return ok(JSON.stringify([
      { url: 'https://github.com/new/list/pull/5', number: 5, title: 'Add mine', state: 'OPEN', isDraft: false, headRefName: 'rdk/list/add-mine' },
    ]));
  };

  const prs = discoverOwnedPrs({ gh, cwd: '/nowhere', targets: [] });
  const rows = matchAdoptable(prs);

  assert.deepEqual(calls, [SEARCH_ARGS, listArgs('new/list')]);
  assert.deepEqual(prs, [
    { url: 'https://github.com/new/list/pull/5', target: 'new/list', number: 5, state: 'OPEN', isDraft: false, headRefName: 'rdk/list/add-mine' },
  ]);
  assert.deepEqual(rows, [
    { url: 'https://github.com/new/list/pull/5', target: 'new/list', branch: 'rdk/list/add-mine', number: 5, state: 'OPEN' },
  ]);
});

test('discoverOwnedPrs skips a failed gh call without throwing', () => {
  const gh = (args) => {
    if (args[0] === 'search') return { ok: false, stdout: '', stderr: 'gh auth missing', code: 1 };
    if (args[3] === 'foo/bar') return ok('not json');
    return ok(JSON.stringify([
      { url: 'https://github.com/other/repo/pull/2', number: 2, title: 'Add mine', state: 'OPEN', isDraft: false, headRefName: 'rdk/repo/add-mine' },
    ]));
  };

  const prs = discoverOwnedPrs({ gh, cwd: '/nowhere', targets: ['foo/bar', 'other/repo'] });

  assert.deepEqual(prs, [
    { url: 'https://github.com/other/repo/pull/2', target: 'other/repo', number: 2, state: 'OPEN', isDraft: false, headRefName: 'rdk/repo/add-mine' },
  ]);
});

test('applyAdopt appends rows and returns null for an unparsable ledger', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-adopt-'));
  try {
    const rows = [
      { adopted: true, channel: 'awesome-list', mechanism: 'git-pr', artifact: 'readme-row', target: 'foo/bar', branch: 'rdk/bar/add-mine', pr_url: 'https://github.com/foo/bar/pull/7', status: 'open', dedupe_key: 'awesome-list:foo/bar' },
    ];

    assert.deepEqual(applyAdopt(dir, rows), rows);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8')), rows);

    assert.deepEqual(applyAdopt(dir, []), rows);

    writeFileSync(join(dir, '.discoverability', 'submissions.json'), 'not json');
    assert.equal(applyAdopt(dir, rows), null);
    assert.equal(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'), 'not json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
