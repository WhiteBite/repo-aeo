import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILLS_DIR = join(ROOT, 'skills');

function skillDirs() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(SKILLS_DIR, entry.name))
    .filter((dir) => existsSync(join(dir, 'SKILL.md')));
}

function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  assert.ok(end > 1, 'SKILL.md frontmatter must be closed by a second --- line');
  const fm = lines.slice(1, end);
  const nameLine = fm.find((line) => /^name:/.test(line));
  assert.ok(nameLine, 'SKILL.md frontmatter must declare name');
  const name = nameLine.replace(/^name:\s*/, '').trim();
  const descIndex = fm.findIndex((line) => /^description:/.test(line));
  assert.ok(descIndex >= 0, 'SKILL.md frontmatter must declare description');
  let description = fm[descIndex].replace(/^description:\s*/, '').trim();
  if (/^[>|][+-]?$/.test(description)) description = '';
  for (const line of fm.slice(descIndex + 1)) description += ` ${line.trim()}`;
  return { name, description: description.replace(/\s+/g, ' ').trim() };
}

function referencesBullets(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+References/.test(line));
  if (start === -1) return [];
  const bullets = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (/^-\s/.test(line)) bullets.push(line);
  }
  return bullets;
}

test('SKILL.md frontmatter name matches the skill directory and the naming rules', () => {
  const dirs = skillDirs();
  assert.ok(dirs.length > 0, 'skills/ must contain at least one skill with a SKILL.md');
  for (const dir of dirs) {
    const { name } = frontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    assert.equal(name, basename(dir), `${dir}: frontmatter name "${name}" must equal the directory name`);
    assert.match(name, /^[a-z0-9-]+$/, `${dir}: name must be lowercase alphanumeric with hyphens`);
    assert.ok(name.length <= 64, `${dir}: name must be at most 64 chars, got ${name.length}`);
  }
});

test('SKILL.md description is bounded and carries a Use when trigger', () => {
  for (const dir of skillDirs()) {
    const { description } = frontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    assert.ok(description.length > 0, `${dir}: description must not be empty`);
    assert.ok(description.length <= 1024, `${dir}: description must be at most 1024 chars, got ${description.length}`);
    assert.ok(description.includes('Use when'), `${dir}: description must contain "Use when"`);
  }
});

test('SKILL.md stays under 500 lines', () => {
  for (const dir of skillDirs()) {
    const lines = readFileSync(join(dir, 'SKILL.md'), 'utf8').split(/\r?\n/);
    assert.ok(lines.length < 500, `${dir}: SKILL.md has ${lines.length} lines, the limit is 500`);
  }
});

test('every references/ and scripts/ path in SKILL.md exists and sits one level deep', () => {
  for (const dir of skillDirs()) {
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const mentioned = (text.match(/\b(?:references|scripts)\/[A-Za-z0-9._/-]+/g) || []).map((p) => p.replace(/[._-]+$/, ''));
    assert.ok(mentioned.length > 0, `${dir}: SKILL.md must mention at least one references/ or scripts/ path`);
    for (const rel of mentioned) {
      assert.ok(existsSync(join(dir, rel)), `${dir}: ${rel} is mentioned in SKILL.md but does not exist`);
      assert.ok(rel.split('/').length <= 2, `${dir}: ${rel} must sit directly inside references/ or scripts/, not deeper`);
    }
  }
});

test('every References bullet states when to load the file', () => {
  for (const dir of skillDirs()) {
    const bullets = referencesBullets(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    assert.ok(bullets.length > 0, `${dir}: the References section must list at least one bullet`);
    for (const bullet of bullets) {
      assert.match(bullet, /\b(?:when|if|before|after)\s/i, `${dir}: bullet must state when to load it: ${bullet}`);
    }
  }
});
