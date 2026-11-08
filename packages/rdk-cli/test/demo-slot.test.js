import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSlot } from '../src/util/slot-validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CHECK_SLOT = join(ROOT, 'skills', 'repo-discoverability', 'scripts', 'check-slot.mjs');
const RENDER_DEMO = join(ROOT, 'skills', 'repo-discoverability', 'scripts', 'render-demo.mjs');
const DEMO = join(ROOT, 'demo', 'rdk-audit.json');

function fromCommand(cmd, extra = []) {
  const result = spawnSync(process.execPath, [RENDER_DEMO, '--from-command', cmd, ...extra], { encoding: 'utf8' });
  return { status: result.status, blocks: JSON.parse(result.stdout), stderr: result.stderr || '' };
}

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

test('validateSlot accepts a single surface with 12 blocks and an 80-char line', () => {
  const blocks = Array.from({ length: 12 }, (_, index) => ({ type: 'prose', text: `line ${index}` }));
  blocks[0] = { type: 'prose', text: 'x'.repeat(80) };
  const { errors } = validateSlot({ theme: 'shell', takeaway: 'ok', before: { surface: 'single', blocks }, after: { blocks: [] } });
  assert.deepEqual(errors, []);
});

test('validateSlot rejects a single surface with 13 blocks', () => {
  const blocks = Array.from({ length: 13 }, (_, index) => ({ type: 'prose', text: `line ${index}` }));
  const { errors } = validateSlot({ theme: 'shell', takeaway: 'ok', before: { surface: 'single', blocks }, after: { blocks: [] } });
  assert.ok(errors.some((error) => /12/.test(error)), 'expected a 12-block limit error');
});

test('validateSlot rejects an 81-char line on a single surface', () => {
  const { errors } = validateSlot({ theme: 'shell', takeaway: 'ok', before: { surface: 'single', blocks: [{ type: 'prose', text: 'x'.repeat(81) }] }, after: { blocks: [] } });
  assert.ok(errors.some((error) => /80/.test(error)), 'expected an 80-char limit error');
});

test('validateSlot rejects a single surface with no blocks', () => {
  const { errors } = validateSlot({ theme: 'shell', takeaway: 'ok', before: { surface: 'single', blocks: [] }, after: { blocks: [] } });
  assert.ok(errors.some((error) => /single surface requires/.test(error)), 'expected an empty-blocks error');
});

test('validateSlot accepts palette light and rejects an unknown palette', () => {
  const base = { theme: 'shell', takeaway: 'ok', before: { blocks: [] }, after: { blocks: [] } };
  assert.deepEqual(validateSlot({ ...base, palette: 'light' }).errors, []);
  assert.deepEqual(validateSlot({ ...base, palette: 'dark' }).errors, []);
  const { errors } = validateSlot({ ...base, palette: 'neon' });
  assert.ok(errors.some((error) => /palette/.test(error)), 'expected a palette error');
});

test('render-demo --from-command prints the tool block, both output lines and an exit-0 done block', () => {
  const { status, blocks } = fromCommand(`node -e "console.log('hello'); console.error('warn line'); process.exit(0)"`);
  assert.equal(status, 0);
  assert.equal(blocks[0].type, 'tool');
  assert.equal(blocks[0].kind, 'call');
  const texts = blocks.map((block) => block.text);
  assert.ok(texts.includes('hello'), 'expected the stdout line');
  assert.ok(texts.includes('warn line'), 'expected the stderr line');
  const last = blocks[blocks.length - 1];
  assert.equal(last.type, 'done');
  assert.equal(last.text, 'exit 0');
});

test('render-demo --from-command reports a non-zero exit as a status block', () => {
  const { status, blocks } = fromCommand(`node -e "process.exit(3)"`);
  assert.equal(status, 0);
  const last = blocks[blocks.length - 1];
  assert.equal(last.type, 'status');
  assert.equal(last.text, 'exit 3');
});

test('render-demo --from-command truncates an output line to 50 chars', () => {
  const { blocks } = fromCommand(`node -e "console.log('x'.repeat(80))"`);
  const line = blocks.find((block) => block.type === 'status' && block.text.startsWith('x'));
  assert.ok(line, 'expected the long output line');
  assert.ok(line.text.length <= 50, `expected <=50 chars, got ${line.text.length}`);
});

test('render-demo --from-command collapses earlier lines into one omitted status block', () => {
  const { blocks } = fromCommand(`node -e "for(let i=1;i<=12;i++)console.log('line '+i)"`, ['--max-lines', '5']);
  const omitted = blocks.find((block) => /earlier lines omitted/.test(block.text));
  assert.ok(omitted, 'expected an omitted-lines status block');
  assert.equal(omitted.text, '... 7 earlier lines omitted');
  assert.equal(blocks.filter((block) => /^line \d+$/.test(block.text)).length, 5);
});

function withTempFrames(frames, run) {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-frames-'));
  const file = join(dir, 'demo.frames.json');
  writeFileSync(file, JSON.stringify(frames));
  try {
    return run(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('render-demo --frames prepares each frame into the out-dir', () => {
  const frame = (text) => ({ theme: 'shell', takeaway: 'ok', before: { blocks: [{ type: 'prose', text }] }, after: { blocks: [] } });
  withTempFrames([frame('beat one'), frame('beat two')], (file, dir) => {
    const out = join(dir, 'out');
    const result = spawnSync(process.execPath, [RENDER_DEMO, '--frames', file, '--out-dir', out], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(existsSync(join(out, 'frame-00.json')), 'expected frame-00.json');
    assert.ok(existsSync(join(out, 'frame-01.json')), 'expected frame-01.json');
    const first = JSON.parse(readFileSync(join(out, 'frame-00.json'), 'utf8'));
    assert.equal(first.theme, 'shell');
    assert.equal(first.before.blocks[0].text, 'beat one');
  });
});

test('check-slot.mjs validates a frames array element by element', () => {
  const good = { theme: 'shell', takeaway: 'ok', before: { blocks: [] }, after: { blocks: [] } };
  const bad = { theme: 'shell', before: { blocks: [] }, after: { blocks: [] } };
  withTempFrames([good, good], (file) => {
    assert.equal(checkSlotExit([file]), 0);
  });
  withTempFrames([good, bad], (file) => {
    const result = checkSlotResult([file]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[1\]/);
  });
});

test('render-demo --frames rejects a non-array frames file', () => {
  withTempFrames({ theme: 'shell' }, (file, dir) => {
    const result = spawnSync(process.execPath, [RENDER_DEMO, '--frames', file, '--out-dir', join(dir, 'out')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /non-empty array/);
  });
});
