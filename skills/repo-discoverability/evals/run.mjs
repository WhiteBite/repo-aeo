#!/usr/bin/env node
/**
 * Trigger-eval for the repo-discoverability skill, per the agentskills.io
 * methodology: the description carries the entire triggering burden, so each
 * labeled query is shown to a model together with only the skill name and
 * description, three times; should-trigger queries must fire at rate >= 0.5
 * and near-miss negatives must stay below it.
 *
 * Requires RDK_EVAL_MODEL and RDK_EVAL_API_KEY; RDK_EVAL_BASE_URL defaults to
 * the OpenAI-compatible endpoint. Without them the run is skipped (exit 0) so
 * CI stays green for contributors without eval credentials.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RUNS = 3;
const THRESHOLD = 0.5;

function skillFrontmatter() {
  const text = readFileSync(join(here, '..', 'SKILL.md'), 'utf8');
  const body = text.split('---')[1] || '';
  const name = /^name:\s*(.+)$/m.exec(body);
  const descStart = body.indexOf('description:');
  const lines = body.slice(descStart).split('\n').slice(1);
  const description = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  return { name: name ? name[1].trim() : 'repo-discoverability', description };
}

async function askOnce(baseUrl, model, apiKey, skill, query) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You route user requests to agent skills. A skill is loaded only when its description matches the request. Answer with a single word: YES if you would load the skill, NO otherwise.',
        },
        {
          role: 'user',
          content: `Skill name: ${skill.name}\nSkill description: ${skill.description}\n\nUser request: ${query}\n\nYES or NO?`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`eval API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const payload = await response.json();
  const text = String(payload.choices?.[0]?.message?.content || '').trim().toUpperCase();
  return text.startsWith('YES');
}

const model = process.env.RDK_EVAL_MODEL;
const apiKey = process.env.RDK_EVAL_API_KEY;
if (!model || !apiKey) {
  console.log('skill evals skipped: set RDK_EVAL_MODEL and RDK_EVAL_API_KEY to run them');
  process.exit(0);
}
const baseUrl = (process.env.RDK_EVAL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const skill = skillFrontmatter();
const { queries } = JSON.parse(readFileSync(join(here, 'queries.json'), 'utf8'));

let failures = 0;
console.log(`| query | should | rate | verdict |`);
console.log(`| --- | --- | --- | --- |`);
for (const query of queries) {
  let hits = 0;
  for (let run = 0; run < RUNS; run += 1) {
    if (await askOnce(baseUrl, model, apiKey, skill, query.text)) hits += 1;
  }
  const rate = hits / RUNS;
  const ok = query.should_trigger ? rate >= THRESHOLD : rate < THRESHOLD;
  if (!ok) failures += 1;
  console.log(`| ${query.text} | ${query.should_trigger ? 'trigger' : 'skip'} | ${rate.toFixed(2)} | ${ok ? 'pass' : 'FAIL'} |`);
}
console.log('');
console.log(failures === 0 ? `all ${queries.length} queries within threshold` : `${failures} quer(y/ies) outside threshold`);
process.exit(failures === 0 ? 0 : 1);
