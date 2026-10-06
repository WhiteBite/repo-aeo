import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'repo-discoverability');

for (const rel of ['SKILL.md', join('references', 'distribution-playbook.md')]) {
  test(`${rel} documents rdk track and the guarded write chain`, () => {
    const text = readFileSync(join(SKILL_DIR, rel), 'utf8');
    assert.ok(text.includes('rdk track'), `${rel} must document the "rdk track" command`);
    assert.ok(text.includes('--plan-digest'), `${rel} must document the --plan-digest guard`);
  });
}
