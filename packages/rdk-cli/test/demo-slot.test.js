import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSlot } from '../src/util/slot-validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CHECK_SLOT = join(ROOT, 'skills', 'repo-discoverability', 'scripts', 'check-slot.mjs');
const DEMO = join(ROOT, 'demo', 'rdk-audit.json');

function checkSlotExit(files) {
  try {
    execFileSync(process.execPath, [CHECK_SLOT, ...files], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

function withTempSlot(slot, run) {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-slot-'));
  const file = join(dir, 'slot.json');
  writeFileSync(file, JSON.stringify(slot));
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('check-slot.mjs accepts the committed demo slot JSON', () => {
  assert.equal(checkSlotExit([DEMO]), 0);
});

test('check-slot.mjs rejects a slot without a takeaway', () => {
  const exit = withTempSlot({ theme: 'shell', before: { blocks: [] }, after: { blocks: [] } }, (file) => checkSlotExit([file]));
  assert.equal(exit, 1);
});

test('check-slot.mjs rejects a panel with six blocks', () => {
  const blocks = Array.from({ length: 6 }, (_, index) => ({ type: 'prose', text: `line ${index}` }));
  const exit = withTempSlot({ theme: 'shell', takeaway: 'ok', before: { blocks }, after: { blocks: [] } }, (file) => checkSlotExit([file]));
  assert.equal(exit, 1);
});

test('validateSlot accepts a minimal valid slot', () => {
  const { errors } = validateSlot({ theme: 'shell', takeaway: 'ok', before: { blocks: [] }, after: { blocks: [] } });
  assert.deepEqual(errors, []);
});

test('validateSlot flags an unknown theme, a missing takeaway and a long line', () => {
  const { errors } = validateSlot({
    theme: 'vim',
    before: { blocks: [{ type: 'prose', text: 'x'.repeat(51) }] },
    after: { blocks: [] },
  });
  assert.ok(errors.some((error) => /theme/.test(error)), 'expected a theme error');
  assert.ok(errors.some((error) => /takeaway/.test(error)), 'expected a takeaway error');
  assert.ok(errors.some((error) => /50/.test(error)), 'expected a line-length error');
});

test('validateSlot warns on an absent surface and an unknown block type', () => {
  const { errors, warnings } = validateSlot({
    theme: 'shell',
    takeaway: 'ok',
    before: { blocks: [{ type: 'sparkle', text: 'hi' }] },
    after: { blocks: [] },
  });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /surface absent/.test(warning)), 'expected a surface warning');
  assert.ok(warnings.some((warning) => /unknown block type/.test(warning)), 'expected an unknown-block warning');
});

test('validateSlot rejects a schema key that is not 4', () => {
  const { errors } = validateSlot({ schema: 3, theme: 'shell', takeaway: 'ok', before: { blocks: [] }, after: { blocks: [] } });
  assert.ok(errors.some((error) => /schema/.test(error)), 'expected a schema error');
});
