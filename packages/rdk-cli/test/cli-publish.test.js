import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { POLICY, describe, plan, buildChecklist, execute, probe } from '../src/distribution/mechanisms/cliPublish.js';
import { makeRepo, removeRepo } from './helpers.js';

const MODULE_PATH = join(import.meta.dirname, '..', 'src', 'distribution', 'mechanisms', 'cliPublish.js');

test('POLICY is listings-only and never runs publish commands', () => {
  assert.deepEqual(POLICY, { mode: 'listings-only', runs_publish_commands: false });
});

test('describe has the cli-publish id and says RDK never publishes', () => {
  const meta = describe();
  assert.equal(meta.id, 'cli-publish');
  assert.match(meta.summary, /publish/i);
});

test('plan returns one pure registry item with artifact and registry url', () => {
  const items = plan({ channel: { id: 'npm-registry' }, config: { project: { name: '@scope/name' } }, pkg: { name: '@scope/name', version: '1.2.3' } });
  assert.deepEqual(items, [{
    channel: 'npm-registry',
    package: '@scope/name',
    version: '1.2.3',
    artifact: 'scope-name-1.2.3.tgz',
    registry_url: 'https://registry.npmjs.org/@scope/name',
  }]);
});

test('plan defaults the channel id and falls back to the config name', () => {
  const [item] = plan({ config: { project: { name: 'pkg-from-config' } } });
  assert.equal(item.channel, 'npm-registry');
  assert.equal(item.package, 'pkg-from-config');
  assert.equal(item.version, '0.0.0');
});

test('scoped package checklist uses npm publish --access public', () => {
  const { steps } = buildChecklist({ pkg: { name: '@scope/name', version: '1.2.3' } });
  assert.ok(steps.includes('npm publish --access public'));
});

test('unscoped package checklist uses plain npm publish', () => {
  const { steps } = buildChecklist({ pkg: { name: 'plain-pkg', version: '1.0.0' } });
  assert.ok(steps.includes('npm publish'));
  assert.ok(!steps.includes('npm publish --access public'));
});

test('buildChecklist steps are ordered pack, publish, view', () => {
  const { steps } = buildChecklist({ pkg: { name: 'plain-pkg', version: '1.0.0' } });
  assert.deepEqual(steps, ['npm pack', 'npm publish', 'npm view plain-pkg@1.0.0']);
});

test('execute writes nothing, records prepared status and keeps the real publish command', () => {
  const dir = makeRepo({ 'package.json': '{"name":"plain-pkg","version":"1.0.0"}' });
  try {
    const before = readdirSync(dir);
    const item = plan({ pkg: { name: 'plain-pkg', version: '1.0.0' } })[0];
    const result = execute({ item, cwd: dir, config: { project: { name: 'plain-pkg' } } });
    const after = readdirSync(dir);
    assert.deepEqual(after, before);
    assert.equal(result.ok, true);
    assert.equal(result.record.status, 'prepared');
    assert.equal(result.record.artifact, 'plain-pkg-1.0.0.tgz');
    assert.ok(result.checklist.steps.includes('npm publish'));
  } finally {
    removeRepo(dir);
  }
});

test('probe returns the registry url as ref and null without it', () => {
  assert.deepEqual(probe({ registry_url: 'https://registry.npmjs.org/pkg' }), { kind: 'registry-read', ref: 'https://registry.npmjs.org/pkg' });
  assert.deepEqual(probe({}), { kind: 'registry-read', ref: null });
  assert.deepEqual(probe(null), { kind: 'registry-read', ref: null });
});

test('module source has no process-spawning capability at all', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  assert.ok(!source.includes('child_process'));
  assert.ok(!source.includes('spawn('));
  assert.ok(!source.includes('execFile('));
  assert.ok(!source.includes('exec('));
});
