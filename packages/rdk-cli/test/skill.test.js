import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { skillCommand, skillSourceDir, skillTargets, SKILL_NAME } from '../src/commands/skill.js';

function twoTargets() {
  const a = mkdtempSync(join(tmpdir(), 'rdk-skill-a-'));
  const b = mkdtempSync(join(tmpdir(), 'rdk-skill-b-'));
  const targets = () => [{ harness: 'custom', dir: a }, { harness: 'custom', dir: b }];
  return {
    a,
    b,
    targets,
    cleanup() {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    },
  };
}

test('skill install links the skill and is idempotent', () => {
  const box = twoTargets();
  try {
    const source = skillSourceDir();
    assert.ok(source, 'the skill source must resolve in a repo checkout');
    const first = skillCommand({ cwd: process.cwd(), options: { action: 'install', targets: box.targets() } });
    assert.equal(first.ok, true, first.output);
    assert.match(first.output, /custom: linked/);
    assert.equal(lstatSync(join(box.a, SKILL_NAME)).isSymbolicLink(), true);
    assert.equal(resolve(join(box.a, SKILL_NAME), readlinkSync(join(box.a, SKILL_NAME))), resolve(source));

    const second = skillCommand({ cwd: process.cwd(), options: { action: 'install', targets: box.targets() } });
    assert.match(second.output, /custom: already linked/);

    const status = skillCommand({ cwd: process.cwd(), options: { action: 'status', targets: box.targets() } });
    assert.match(status.output, /custom: linked/);
  } finally {
    box.cleanup();
  }
});

test('skill install never clobbers a manual copy and uninstall removes only our link', () => {
  const box = twoTargets();
  try {
    const manual = join(box.b, SKILL_NAME);
    mkdirSync(manual, { recursive: true });
    writeFileSync(join(manual, 'SKILL.md'), '# mine\n');

    const installed = skillCommand({ cwd: process.cwd(), options: { action: 'install', targets: box.targets() } });
    assert.equal(installed.ok, false, 'a manual copy must be reported, not overwritten');
    assert.match(installed.output, /custom: skipped \(manual/);
    assert.equal(readFileSync(join(manual, 'SKILL.md'), 'utf8'), '# mine\n');

    const uninstalled = skillCommand({ cwd: process.cwd(), options: { action: 'uninstall', targets: box.targets() } });
    assert.match(uninstalled.output, /custom: removed/);
    assert.equal(existsSync(join(box.a, SKILL_NAME)), false);
    assert.equal(existsSync(manual), true, 'the manual copy must survive uninstall');
    assert.equal(existsSync(join(skillSourceDir(), 'SKILL.md')), true, 'uninstall must never touch the link target');
  } finally {
    box.cleanup();
  }
});

test('skill status reports absent targets without creating anything', () => {
  const box = twoTargets();
  try {
    const status = skillCommand({ cwd: process.cwd(), options: { action: 'status', targets: box.targets() } });
    assert.match(status.output, /custom: absent/);
    assert.equal(existsSync(join(box.a, SKILL_NAME)), false);
  } finally {
    box.cleanup();
  }
});

test('skillTargets defaults keep the registry-derived dirs, labels and order', () => {
  const home = homedir();
  assert.deepEqual(skillTargets({ cwd: join(tmpdir(), 'w') }), [
    { harness: 'opencode', dir: join(home, '.config', 'opencode', 'skills') },
    { harness: 'claude', dir: join(home, '.claude', 'skills') },
    { harness: 'codex', dir: join(home, '.codex', 'skills') },
  ]);
  assert.deepEqual(skillTargets({ cwd: join(tmpdir(), 'w'), project: true }), [
    { harness: 'opencode-project', dir: join(tmpdir(), 'w', '.opencode', 'skills') },
    { harness: 'claude-project', dir: join(tmpdir(), 'w', '.claude', 'skills') },
  ]);
});
