import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit/index.js';
import { makeRepo, removeRepo } from './helpers.js';

const PKG = { name: 'demo-visual', version: '1.0.0', description: 'demo visual gate package', bin: { 'demo-visual': 'cli.js' } };

const BASE_README = [
  '# Demo visual',
  '',
  'A readme body long enough to count as a real readme for the audit tallies,',
  'so the demo-visual gate can be exercised in isolation from readme.exists.',
  '',
  '## Quickstart',
  '',
  '```bash',
  'npm install demo-visual',
  '```',
  '',
].join('\n');

async function demoVisualFinding(files) {
  const dir = makeRepo({ 'package.json': JSON.stringify(PKG), ...files });
  try {
    const report = await audit(dir, { online: false });
    return report.findings.find((f) => f.id === 'readme.demo_visual') || null;
  } finally {
    removeRepo(dir);
  }
}

test('a markdown gif image satisfies readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': `${BASE_README}\n![demo](assets/demo.gif)\n` });
  assert.equal(finding, null);
});

test('an html img gif satisfies readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': `${BASE_README}\n<img src="assets/demo.gif" alt="demo">\n` });
  assert.equal(finding, null);
});

test('a github actions badge does not satisfy readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': `${BASE_README}\n![ci](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)\n` });
  assert.ok(finding, 'expected a readme.demo_visual finding');
  assert.equal(finding.severity, 'warn');
});

test('a shields badge does not satisfy readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': `${BASE_README}\n![license](https://img.shields.io/badge/license-MIT.svg)\n` });
  assert.ok(finding, 'expected a readme.demo_visual finding');
});

test('a logo image does not satisfy readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': `${BASE_README}\n![logo](logo/icon.svg)\n` });
  assert.ok(finding, 'expected a readme.demo_visual finding');
});

test('a static png under a Demo heading satisfies readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': `${BASE_README}\n## Demo\n\n![shot](assets/shot.png)\n` });
  assert.equal(finding, null);
});

test('a readme without any image triggers readme.demo_visual', async () => {
  const finding = await demoVisualFinding({ 'README.md': BASE_README });
  assert.ok(finding, 'expected a readme.demo_visual finding');
  assert.equal(finding.severity, 'warn');
});

async function demoAssetFinding(files) {
  const dir = makeRepo({ 'package.json': JSON.stringify(PKG), ...files });
  try {
    const report = await audit(dir, { online: false });
    return report.findings.find((f) => f.id === 'readme.demo_asset') || null;
  } finally {
    removeRepo(dir);
  }
}

const FRAME = { theme: 'shell', takeaway: 'ok', before: { blocks: [{ type: 'prose', text: 'beat' }] }, after: { blocks: [] } };

test('a valid frames array in demo/ passes readme.demo_asset', async () => {
  const finding = await demoAssetFinding({
    'README.md': `${BASE_README}\n![demo](assets/demo.gif)\n`,
    'demo/frames.json': JSON.stringify([FRAME, FRAME]),
  });
  assert.equal(finding, null);
});

test('an invalid frame in a frames array triggers readme.demo_asset', async () => {
  const broken = { ...FRAME };
  delete broken.takeaway;
  const finding = await demoAssetFinding({
    'README.md': `${BASE_README}\n![demo](assets/demo.gif)\n`,
    'demo/frames.json': JSON.stringify([FRAME, broken]),
  });
  assert.ok(finding, 'expected a readme.demo_asset finding');
  assert.match(finding.fix, /frame 1/);
});
