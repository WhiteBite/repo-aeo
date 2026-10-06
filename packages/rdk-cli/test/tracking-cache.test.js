import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, removeRepo } from './helpers.js';
import {
  trackingCachePath,
  readTrackingCache,
  writeTrackingCache,
  snapshotKey,
} from '../src/distribution/tracking/cache.js';

test('readTrackingCache returns an empty snapshot set when missing and rotates a corrupt file', () => {
  const cwd = makeRepo();
  try {
    assert.deepEqual(readTrackingCache(cwd), { schema_version: 'rdk-tracking/1', snapshots: {} });

    mkdirSync(join(cwd, '.discoverability', 'cache'), { recursive: true });
    writeFileSync(trackingCachePath(cwd), '{not json', 'utf8');

    let result;
    assert.doesNotThrow(() => {
      result = readTrackingCache(cwd);
    });
    assert.deepEqual(result, { schema_version: 'rdk-tracking/1', snapshots: {} });

    const rotated = readdirSync(join(cwd, '.discoverability', 'cache')).filter((name) => /^tracking\.json\.corrupt-/.test(name));
    assert.equal(rotated.length, 1);
    assert.equal(readFileSync(join(cwd, '.discoverability', 'cache', rotated[0]), 'utf8'), '{not json');
    assert.ok(!existsSync(trackingCachePath(cwd)));
  } finally {
    removeRepo(cwd);
  }
});

test('readTrackingCache rotates a structurally invalid file aside and starts empty', () => {
  const cwd = makeRepo();
  try {
    mkdirSync(join(cwd, '.discoverability', 'cache'), { recursive: true });
    writeFileSync(trackingCachePath(cwd), '{}', 'utf8');

    let result;
    assert.doesNotThrow(() => {
      result = readTrackingCache(cwd);
    });
    assert.deepEqual(result, { schema_version: 'rdk-tracking/1', snapshots: {} });

    const rotated = readdirSync(join(cwd, '.discoverability', 'cache')).filter((name) => /^tracking\.json\.corrupt-/.test(name));
    assert.equal(rotated.length, 1);
    assert.equal(readFileSync(join(cwd, '.discoverability', 'cache', rotated[0]), 'utf8'), '{}');
    assert.ok(!existsSync(trackingCachePath(cwd)));
  } finally {
    removeRepo(cwd);
  }
});

test('writeTrackingCache is atomic and readTrackingCache round-trips', () => {
  const cwd = makeRepo();
  try {
    const cache = {
      schema_version: 'rdk-tracking/1',
      snapshots: {
        'awesome-list:foo': {
          state: 'submitted',
          review_decision: null,
          checks: [],
          close_reason: 'stale',
          fetched_at: '2026-10-06T00:00:00Z',
          last_push: '2026-10-05T12:00:00Z',
        },
      },
    };

    const path = writeTrackingCache(cwd, cache);
    assert.equal(path, trackingCachePath(cwd));
    assert.ok(existsSync(path));
    assert.deepEqual(readTrackingCache(cwd), cache);

    const leftovers = readdirSync(join(cwd, '.discoverability', 'cache')).filter((name) => name !== 'tracking.json');
    assert.deepEqual(leftovers, []);
  } finally {
    removeRepo(cwd);
  }
});

test('trackingCachePath lives under .discoverability/cache and is never the committed ledger', () => {
  const cwd = makeRepo();
  try {
    const path = trackingCachePath(cwd);
    assert.equal(path, join(cwd, '.discoverability', 'cache', 'tracking.json'));
    assert.ok(!path.endsWith('submissions.json'));
  } finally {
    removeRepo(cwd);
  }
});

test('snapshotKey prefers dedupe_key, then pr_url, then channel:target', () => {
  assert.equal(snapshotKey({ dedupe_key: 'dk', pr_url: 'https://x/y/pull/1', channel: 'a', target: 'b' }), 'dk');
  assert.equal(snapshotKey({ pr_url: 'https://x/y/pull/1', channel: 'a', target: 'b' }), 'https://x/y/pull/1');
  assert.equal(snapshotKey({ channel: 'awesome-list', target: 'vite' }), 'awesome-list:vite');
});
