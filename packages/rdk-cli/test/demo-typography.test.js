import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSlot } from '../src/util/slot-validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'skills', 'repo-discoverability', 'scripts', 'check-typography.mjs');
const TEMPLATE = join(ROOT, 'skills', 'repo-discoverability', 'scripts', 'demo-terminal.html');
const HERO_TEMPLATE = join(ROOT, 'skills', 'repo-discoverability', 'scripts', 'hero.html');
const SOURCE = readFileSync(TEMPLATE, 'utf8');

function run(...files) {
  const result = spawnSync(process.execPath, [SCRIPT, ...files], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function sabotage(mutate) {
  const mutated = mutate(SOURCE);
  if (mutated === SOURCE) throw new Error('sabotage mutation did not change the template');
  const dir = mkdtempSync(join(tmpdir(), 'rdk-typo-'));
  const file = join(dir, 'template.html');
  writeFileSync(file, mutated);
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function base(blocks) {
  return { theme: 'shell', takeaway: 'ok', before: { blocks }, after: { blocks: [] } };
}

test('check-typography.mjs accepts the locked demo template', () => {
  const result = run(TEMPLATE);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ok/);
});

test('check-typography.mjs accepts the locked hero template', () => {
  const result = run(TEMPLATE, HERO_TEMPLATE);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /demo-terminal\.html: ok/);
  assert.match(result.stdout, /hero\.html: ok/);
});

test('check-typography.mjs rejects a body line below the text floor', () => {
  const result = sabotage((source) => source.replace(/(\.prose-line\s*\{[^}]*?font-size:\s*)\d+px/, (_, prefix) => `${prefix}11px`));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prose-line/);
  assert.match(result.stderr, /minimum|below|13/);
});

test('check-typography.mjs rejects an unmapped selector with a font-size', () => {
  const result = sabotage((source) => source.replace('</style>', '  .mystery-text { font-size: 15px; }\n</style>'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unmapped/);
});

test('check-typography.mjs rejects a remote font resource', () => {
  const result = sabotage((source) => source.replace('</style>', '  @font-face { font-family: x; src: url(http://x/y.woff2); }\n</style>'));
  assert.equal(result.status, 1);
});

test('check-typography.mjs rejects a non-px font-size unit', () => {
  const result = sabotage((source) => source.replace(/(\.hud\s*\{[^}]*?font-size:\s*)[^;]+;/, (_, prefix) => `${prefix}0.8em;`));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /px/);
});

test('check-typography.mjs rejects a template without the 900px stage', () => {
  const result = sabotage((source) => source.replace('width: 900px', 'width: 800px'));
  assert.equal(result.status, 1);
});

test('validateSlot rejects a 38-char block line at the 37-char limit', () => {
  const { errors } = validateSlot(base([{ type: 'prose', text: 'x'.repeat(38) }]));
  assert.ok(errors.some((error) => /37/.test(error)), 'expected a 37-char limit error');
});

test('validateSlot accepts a 36-char block line', () => {
  const { errors } = validateSlot(base([{ type: 'prose', text: 'x'.repeat(36) }]));
  assert.ok(!errors.some((error) => /exceeds/.test(error)), `unexpected length error: ${errors.join('; ')}`);
});

test('validateSlot warns when a gate line exceeds 35 chars', () => {
  const { errors, warnings } = validateSlot(base([{ type: 'gate', title: 'gate', lines: ['x'.repeat(36)] }]));
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /gate card|narrowest/.test(warning)), 'expected the gate-container warning');
});