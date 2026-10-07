import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLlmsTxt, renderAgentsMd } from '../src/generate/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILL_DIR = join(ROOT, 'skills', 'repo-discoverability');

for (const rel of ['SKILL.md', join('references', 'distribution-playbook.md')]) {
  test(`${rel} documents rdk track and the guarded write chain`, () => {
    const text = readFileSync(join(SKILL_DIR, rel), 'utf8');
    assert.ok(text.includes('rdk track'), `${rel} must document the "rdk track" command`);
    assert.ok(text.includes('--plan-digest'), `${rel} must document the --plan-digest guard`);
  });
}

test('references/channels.md references rdk track', () => {
  const text = readFileSync(join(SKILL_DIR, 'references', 'channels.md'), 'utf8');
  assert.ok(text.includes('rdk track'), 'channels.md must reference the "rdk track" command');
});

test('root AGENTS.md documents rdk track and the guarded write chain', () => {
  const text = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(text.includes('rdk track'), 'AGENTS.md must document the "rdk track" command');
  assert.ok(text.includes('--plan-digest'), 'AGENTS.md must document the --plan-digest guard');
});

test('docs/architecture.md documents the tracking contract', () => {
  const text = readFileSync(join(ROOT, 'docs', 'architecture.md'), 'utf8');
  assert.ok(text.includes('submissions.json'), 'architecture.md must name the committed ledger');
  assert.ok(text.includes('rdk-distribution/1'), 'architecture.md must carry the canonical schema id');
  assert.ok(text.includes('--plan-digest'), 'architecture.md must document the guard chain');
});

test('generated llms.txt carries the distribution tracking section', () => {
  const llms = renderLlmsTxt({ project: { name: 'x', one_liner: 'X' } }, null, '# x\n');
  const text = readFileSync(join(ROOT, 'llms.txt'), 'utf8');
  assert.ok(llms.includes('## Distribution tracking'));
  assert.ok(text.includes(llms.slice(llms.indexOf('## Distribution tracking'), llms.indexOf('## Optional')).trimEnd()), 'the root llms.txt must contain the generated tracking section');
});
