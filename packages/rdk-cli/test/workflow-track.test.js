import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'workflows', 'rdk-track.yml');

const workflow = () => readFileSync(WORKFLOW, 'utf8');

test('rdk-track.yml is named rdk-track and fires weekly and on demand', () => {
  const yaml = workflow();
  assert.match(yaml, /^name: rdk-track$/m);
  assert.match(yaml, /^\s*schedule:/m, 'the workflow must run on a schedule');
  assert.match(yaml, /cron:/, 'the schedule must have a cron entry');
  assert.ok(yaml.includes('23 7 * * 2'), 'the weekly cron must stay off-round (23 7 * * 2)');
  assert.match(yaml, /^\s*workflow_dispatch:\s*$/m, 'the workflow must be manually triggerable');
});

test('rdk-track.yml grants contents: read and issues: write', () => {
  const yaml = workflow();
  assert.match(yaml, /contents:\s*read/);
  assert.match(yaml, /issues:\s*write/);
});

test('rdk-track.yml serialises on the rdk-track concurrency group', () => {
  const yaml = workflow();
  assert.match(yaml, /group: rdk-track$/m);
  assert.match(yaml, /cancel-in-progress:\s*false/);
});

test('rdk-track.yml runs rdk track --json and upserts one rdk-tracking issue', () => {
  const yaml = workflow();
  assert.ok(yaml.includes('rdk track --json'), 'the workflow must reference the rdk track --json run');
  assert.ok(yaml.includes('node packages/rdk-cli/bin/rdk.js track --json > track.json'), 'the run step must build track.json');
  assert.ok(yaml.includes('rdk-tracking'), 'the upserted issue must carry the rdk-tracking label');
  assert.ok(yaml.includes('actions/github-script'), 'the issue upsert must use actions/github-script');
});

test('rdk-track.yml never publishes, force-pushes or releases', () => {
  const yaml = workflow();
  assert.ok(!yaml.includes('npm publish'));
  assert.ok(!yaml.includes('git push --force'));
  assert.ok(!yaml.includes('gh release'));
});
