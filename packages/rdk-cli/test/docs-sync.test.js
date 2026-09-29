import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AXIS_WEIGHTS, AXIS_LABELS } from '../src/audit/score.js';
import { githubChecks } from '../src/audit/checks/github.js';
import { readmeChecks } from '../src/audit/checks/readme.js';
import { agentsChecks } from '../src/audit/checks/agents.js';
import { npmChecks } from '../src/audit/checks/npm.js';
import { docsChecks } from '../src/audit/checks/docs.js';
import { hygieneChecks } from '../src/audit/checks/hygiene.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTRY = [...githubChecks, ...readmeChecks, ...agentsChecks, ...npmChecks, ...docsChecks, ...hygieneChecks];
const LABEL_TO_KEY = Object.fromEntries(Object.entries(AXIS_LABELS).map(([key, label]) => [label, key]));
const SHORT_TO_KEY = { GitHub: 'github', README: 'readme', Agents: 'agents', npm: 'npm', Docs: 'docs', Hygiene: 'hygiene' };

function axisDrift(seen, source) {
  const drift = [];
  for (const [key, weight] of Object.entries(AXIS_WEIGHTS)) {
    const documented = seen.get(key);
    if (documented === undefined) drift.push(`- ${AXIS_LABELS[key]}: missing from ${source} (code weight ${weight})`);
    else if (documented !== weight) drift.push(`- ${AXIS_LABELS[key]}: ${source} says ${documented}, code says ${weight}`);
  }
  for (const key of seen.keys()) {
    if (!(key in AXIS_WEIGHTS)) drift.push(`- ${key}: documented in ${source} but not an axis in src/audit/score.js`);
  }
  return drift;
}

test('docs/scoring.md axis weights match AXIS_WEIGHTS', () => {
  const text = readFileSync(join(ROOT, 'docs', 'scoring.md'), 'utf8');
  const seen = new Map();
  for (const [, label, weight] of text.matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/gm)) {
    const key = LABEL_TO_KEY[label];
    if (key) seen.set(key, Number(weight));
  }
  const drift = axisDrift(seen, 'docs/scoring.md');
  assert.deepEqual(drift, [], `docs/scoring.md axis table drifted from src/audit/score.js:\n${drift.join('\n')}`);
});

test('skills/repo-discoverability references/scoring.md axis weights match AXIS_WEIGHTS', () => {
  const text = readFileSync(join(ROOT, 'skills', 'repo-discoverability', 'references', 'scoring.md'), 'utf8');
  const line = /^Axis weights: (.+)$/m.exec(text);
  assert.ok(line, 'references/scoring.md must keep an "Axis weights:" summary line');
  const seen = new Map();
  for (const [, name, weight] of line[1].matchAll(/([A-Za-z]+)\s+(\d+)/g)) {
    const key = SHORT_TO_KEY[name];
    assert.ok(key, `references/scoring.md mentions unknown axis "${name}"`);
    seen.set(key, Number(weight));
  }
  const drift = axisDrift(seen, 'references/scoring.md');
  assert.deepEqual(drift, [], `references/scoring.md axis weights drifted from src/audit/score.js:\n${drift.join('\n')}`);
});

test('checks-catalog.md per-check weights match the audit registry', () => {
  const text = readFileSync(join(ROOT, 'skills', 'repo-discoverability', 'references', 'checks-catalog.md'), 'utf8');
  const rows = [...text.matchAll(/^\|\s*`([a-z0-9_.]+)`\s*\|\s*(\d+)\s*\|/gm)];
  assert.ok(rows.length > 0, 'checks-catalog.md must document per-check weights');
  const catalog = new Map(rows.map((row) => [row[1], Number(row[2])]));
  const drift = [];
  for (const definition of REGISTRY) {
    const documented = catalog.get(definition.id);
    if (documented === undefined) drift.push(`- ${definition.id}: missing from checks-catalog.md (code weight ${definition.weight})`);
    else if (documented !== definition.weight) drift.push(`- ${definition.id}: checks-catalog.md says ${documented}, code says ${definition.weight}`);
  }
  for (const id of catalog.keys()) {
    if (!REGISTRY.some((definition) => definition.id === id)) drift.push(`- ${id}: documented in checks-catalog.md but not registered in src/audit/checks`);
  }
  assert.deepEqual(drift, [], `checks-catalog.md drifted from src/audit/checks:\n${drift.join('\n')}`);
});
