import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_ACK, effectiveAck, planDigest } from '../src/commands/githubSync.js';

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
