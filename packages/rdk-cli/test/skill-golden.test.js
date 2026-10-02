import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillCommand, skillSourceDir, SKILL_NAME } from '../src/commands/skill.js';

const goldenPath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'skill-golden.txt');

function buildFixture() {
  const home = mkdtempSync(join(tmpdir(), 'rdk-skill-golden-'));
  const foreign = join(home, 'foreign-skill');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'SKILL.md'), '# foreign\n');
  mkdirSync(join(home, 'h-a', 'skills'), { recursive: true });
  mkdirSync(join(home, 'h-b', 'skills', SKILL_NAME), { recursive: true });
  writeFileSync(join(home, 'h-b', 'skills', SKILL_NAME, 'SKILL.md'), '# mine\n');
  mkdirSync(join(home, 'h-c', 'skills'), { recursive: true });
  symlinkSync(foreign, join(home, 'h-c', 'skills', SKILL_NAME), process.platform === 'win32' ? 'junction' : 'dir');
  mkdirSync(join(home, 'h-d'), { recursive: true });
  const targets = [
    { harness: 'alpha', dir: join(home, 'h-a', 'skills') },
    { harness: 'bravo', dir: join(home, 'h-b', 'skills') },
    { harness: 'charlie', dir: join(home, 'h-c', 'skills') },
    { harness: 'delta', dir: join(home, 'h-d', 'skills') },
    { harness: 'echo', dir: join(home, 'h-e', 'skills') },
  ];
  return { home, targets };
}

function tokenize(text, home, source) {
  let out = text;
  for (const [raw, token] of [[source, '<SOURCE>'], [home, '<HOME>']]) {
    if (process.platform === 'win32') {
      const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(esc, 'gi'), token);
    } else {
      out = out.split(raw).join(token);
    }
  }
  return out.split('\\').join('/');
}

function describeTarget(dir, home, source) {
  const target = join(dir, SKILL_NAME);
  let stat = null;
  try {
    stat = lstatSync(target);
  } catch {
    return `skills-dir=${existsDir(dir)}, target=absent`;
  }
  if (stat.isSymbolicLink()) {
    const dest = resolve(dirname(target), readlinkSync(target));
    return `skills-dir=${existsDir(dir)}, target=link -> ${tokenize(dest, home, source)}`;
  }
  const hash = createHash('sha256').update(readFileSync(join(target, 'SKILL.md'))).digest('hex');
  return `skills-dir=${existsDir(dir)}, target=manual (SKILL.md sha256=${hash})`;
}

function existsDir(dir) {
  try {
    lstatSync(dir);
    return 'yes';
  } catch {
    return 'no';
  }
}

function buildTranscript() {
  const { home, targets } = buildFixture();
  const source = skillSourceDir();
  try {
    const lines = ['# rdk skill golden transcript (paths tokenized, separators normalized)'];
    const actions = ['install', 'status', 'install', 'uninstall', 'status', 'uninstall'];
    actions.forEach((action, index) => {
      const result = skillCommand({ cwd: process.cwd(), options: { action, targets } });
      lines.push('', `## command ${index + 1}: ${action}`, `ok=${result.ok} exitCode=${result.exitCode}`, '--- output ---');
      lines.push(tokenize(result.output, home, source).replace(/\n$/, ''));
      lines.push('--- end output ---', '', '## tree after command ' + (index + 1));
      for (const { harness, dir } of targets) lines.push(`${harness}: ${describeTarget(dir, home, source)}`);
    });
    return `${lines.join('\n')}\n`;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function firstDiffLine(actual, expected) {
  const la = actual.split('\n');
  const le = expected.split('\n');
  for (let i = 0; i < Math.max(la.length, le.length); i++) {
    if (la[i] !== le[i]) return `first diff at line ${i + 1}: golden=${JSON.stringify(le[i])} actual=${JSON.stringify(la[i])}`;
  }
  return 'no line-level diff';
}

test('skill install/uninstall/status output and tree are byte-identical to the golden fixture', () => {
  const actual = buildTranscript();
  if (process.env.RDK_GOLDEN_UPDATE) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, actual);
    return;
  }
  const expected = readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(actual.length > 0, 'the transcript must not be empty');
  assert.equal(actual, expected, `skill install output drifted from the golden fixture (${firstDiffLine(actual, expected)}); review the change, then regenerate with RDK_GOLDEN_UPDATE=1 node --test packages/rdk-cli/test/skill-golden.test.js`);
});
