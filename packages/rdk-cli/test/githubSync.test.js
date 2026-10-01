import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_ACK, effectiveAck, planDigest, githubSyncCommand } from '../src/commands/githubSync.js';

test('planDigest is a stable sha256 of the canonical plan', () => {
  const plan = [{ field: 'topics', from: ['a'], to: ['a', 'b'] }];
  const digest = planDigest(plan);
  assert.match(digest, /^[0-9a-f]{64}$/);
  const canonical = '[{"field":"topics","from":["a"],"to":["a","b"]}]';
  assert.equal(digest, createHash('sha256').update(canonical).digest('hex'));
});

test('planDigest ignores key order and reacts to content changes', () => {
  const plan = [{ field: 'description', from: '', to: 'new text' }];
  const digest = planDigest(plan);
  assert.equal(planDigest([{ to: 'new text', from: '', field: 'description' }]), digest, 'key order must not matter');
  assert.notEqual(planDigest([{ field: 'description', from: '', to: 'other text' }]), digest);
  assert.notEqual(planDigest([{ field: 'description', from: 'old', to: 'new text' }]), digest);
  assert.equal(planDigest([]), planDigest([]));
});

test('effectiveAck prefers a configured safety.ack and falls back to the default', () => {
  assert.equal(effectiveAck({}), DEFAULT_ACK);
  assert.equal(effectiveAck({ safety: {} }), DEFAULT_ACK);
  assert.equal(effectiveAck({ safety: { ack: null } }), DEFAULT_ACK);
  assert.equal(effectiveAck({ safety: { ack: '' } }), DEFAULT_ACK);
  assert.equal(effectiveAck({ safety: { ack: 'CUSTOM_ACK' } }), 'CUSTOM_ACK');
});

const SYNC_CONFIG = {
  project: { one_liner: 'Configured one-liner' },
  links: { homepage: 'https://example.com' },
  keywords: { github_topics: ['cli', 'developer-tools'] },
};

const EMPTY_LIVE = { description: '', homepageUrl: '', repositoryTopics: [] };

function fakeGh(live) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === '--version') return { ok: true, stdout: 'gh version 2.99.0\n', stderr: '', code: 0 };
    if (args[0] === 'repo' && args[1] === 'view') return { ok: true, stdout: JSON.stringify(live), stderr: '', code: 0 };
    if (args[0] === 'api') return { ok: true, stdout: '{}', stderr: '', code: 0 };
    return { ok: false, stdout: '', stderr: `unexpected gh invocation: ${args.join(' ')}`, code: 1 };
  };
  return { runner, calls };
}

test('apply without --plan-digest is refused with plan_digest_required', async () => {
  const gh = fakeGh(EMPTY_LIVE);
  const result = await githubSyncCommand({
    cwd: process.cwd(),
    options: { repo: 'someone/demo', apply: true, ack: DEFAULT_ACK, reason: 'write without a digest' },
    config: SYNC_CONFIG,
    ghRunner: gh.runner,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'plan_digest_required');
  assert.match(result.error, /preview/);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.applied, []);
  assert.equal(gh.calls.length, 0, 'the refusal must precede any gh call');
});

test('the plan digest binds to the fields-filtered plan that apply writes', async () => {
  const gh = fakeGh(EMPTY_LIVE);
  const base = { cwd: process.cwd(), config: SYNC_CONFIG, ghRunner: gh.runner };

  const preview = await githubSyncCommand({ ...base, options: { repo: 'someone/demo', fields: ['description'] } });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.plan.map((change) => change.field), ['description'], 'the preview must show the filtered plan');
  assert.equal(preview.plan_digest, planDigest(preview.plan));

  const applied = await githubSyncCommand({
    ...base,
    options: { repo: 'someone/demo', fields: ['description'], apply: true, ack: DEFAULT_ACK, reason: 'write the approved description only', plan_digest: preview.plan_digest },
  });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.applied, ['description']);
  const writes = gh.calls.filter((args) => args[0] === 'api');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes('description=Configured one-liner'));
});

test('apply with the digest of the unfiltered plan is refused as a mismatch', async () => {
  const gh = fakeGh(EMPTY_LIVE);
  const base = { cwd: process.cwd(), config: SYNC_CONFIG, ghRunner: gh.runner };

  const full = await githubSyncCommand({ ...base, options: { repo: 'someone/demo' } });
  assert.deepEqual(full.plan.map((change) => change.field), ['topics', 'description', 'homepage']);

  const narrowed = await githubSyncCommand({
    ...base,
    options: { repo: 'someone/demo', fields: ['description'], apply: true, ack: DEFAULT_ACK, reason: 'approve the full plan but narrow the write', plan_digest: full.plan_digest },
  });
  assert.equal(narrowed.ok, false);
  assert.equal(narrowed.code, 'plan_digest_mismatch');
  assert.deepEqual(narrowed.applied, []);
  assert.equal(gh.calls.filter((args) => args[0] === 'api').length, 0);
});

test('empty desired topics never plans a topics write and warns instead', async () => {
  const gh = fakeGh({ description: '', homepageUrl: '', repositoryTopics: [{ name: 'keep-me' }] });
  const config = { project: { one_liner: 'Configured one-liner' }, links: {}, keywords: { github_topics: [] } };
  const base = { cwd: process.cwd(), config, ghRunner: gh.runner };

  const preview = await githubSyncCommand({ ...base, options: { repo: 'someone/demo' } });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.plan.map((change) => change.field), ['description']);
  assert.match(preview.output, /desired topics empty - refusing to clear remote topics/);

  const applied = await githubSyncCommand({
    ...base,
    options: { repo: 'someone/demo', apply: true, ack: DEFAULT_ACK, reason: 'sync the description only', plan_digest: preview.plan_digest },
  });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.applied, ['description']);
  for (const args of gh.calls) {
    assert.ok(!args.some((arg) => String(arg).includes('/topics')), 'the remote topics must never be cleared');
  }
});
