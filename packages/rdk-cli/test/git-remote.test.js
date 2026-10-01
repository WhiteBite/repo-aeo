import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote } from '../src/util/git.js';

const NULLS = { host: null, owner: null, repo: null };

const fixtures = [
  ['ssh://git@github.com:22/owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['ssh://git@gitlab.com:2222/group/sub/repo.git', { host: 'gitlab.com', owner: 'group', repo: 'sub/repo' }],
  ['https://user:pw@github.com/owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['git://github.com/owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['git@github.com:owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['git@gitlab.com:group/sub/repo.git', { host: 'gitlab.com', owner: 'group', repo: 'sub/repo' }],
  ['https://github.com/owner/repo', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['https://github.com/owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['https://github.com/owner/repo.git/', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['ssh://git@github.com/owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['ssh://git@github.com:owner/repo.git', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['github.com/owner/repo', { host: 'github.com', owner: 'owner', repo: 'repo' }],
  ['https://github.com/owner', NULLS],
  ['not a url', NULLS],
  ['', NULLS],
  [null, NULLS],
];

test('parseRemote maps every remote URL form to host/owner/repo', () => {
  for (const [url, expected] of fixtures) {
    assert.deepEqual(parseRemote(url), expected, `parseRemote(${JSON.stringify(url)})`);
  }
});

test('parseRemote never throws on hostile input', () => {
  for (const url of ['ssh://', 'git://git@', '://', 'ssh:/github.com/owner/repo', 'https://github.com', undefined]) {
    assert.doesNotThrow(() => parseRemote(url));
  }
});
