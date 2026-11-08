import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

function checkSlotResult(files) {
  const result = spawnSync(process.execPath, [CHECK_SLOT, ...files], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr || '' };
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

test('check-slot.mjs accepts a shots panel with a shot and annotations', () => {
  const slot = {
    theme: 'shell',
    takeaway: 'ok',
    before: {
      surface: 'shots',
      shot: 'data:image/png;base64,AAAA',
      shotCaption: 'before',
      annotations: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'gap', dim: true }],
    },
    after: { surface: 'shots', shot: 'data:image/png;base64,BBBB', annotations: [{ x: 0.4, y: 0.5, w: 0.2, h: 0.2, color: 'green' }] },
  };
  const exit = withTempSlot(slot, (file) => checkSlotExit([file]));
  assert.equal(exit, 0);
});

test('check-slot.mjs rejects a shots panel without a shot', () => {
  const slot = { theme: 'shell', takeaway: 'ok', before: { surface: 'shots' }, after: { blocks: [] } };
  const exit = withTempSlot(slot, (file) => checkSlotExit([file]));
  assert.equal(exit, 1);
});

test('validateSlot warns on blocks placed on a shots panel', () => {
  const { errors, warnings } = validateSlot({
    theme: 'shell',
    takeaway: 'ok',
    before: { surface: 'shots', shot: 'data:image/png;base64,AAAA', blocks: [{ type: 'prose', text: 'hi' }] },
    after: { blocks: [] },
  });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /shots panel/.test(warning)), 'expected a shots-blocks warning');
});

test('validateSlot warns on a steps block with more than eight entries', () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({ text: `step ${index}`, state: 'ok' }));
  const { errors, warnings } = validateSlot({
    theme: 'shell',
    takeaway: 'ok',
    before: { blocks: [{ type: 'steps', steps }] },
    after: { blocks: [] },
  });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /steps/.test(warning)), 'expected a steps warning');
});

test('check-slot.mjs exits 0 with a warning for a ten-step block', () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({ text: `step ${index}`, state: 'ok' }));
  const slot = { theme: 'shell', takeaway: 'ok', before: { blocks: [{ type: 'steps', steps }] }, after: { blocks: [] } };
  const result = withTempSlot(slot, (file) => checkSlotResult([file]));
  assert.equal(result.status, 0);
  assert.match(result.stderr, /steps/);
});

test('validateSlot rejects an unknown surface', () => {
  const { errors } = validateSlot({ theme: 'shell', takeaway: 'ok', before: { surface: 'canvas', blocks: [] }, after: { blocks: [] } });
  assert.ok(errors.some((error) => /surface/.test(error)), 'expected a surface error');
});
