import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// vendored tree is read-only: changes go upstream to harness-kit, then re-vendor
const vendorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'harness-kit');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

test('vendored harness-kit files match the manifest sha256 (LF-normalized)', () => {
  const manifest = JSON.parse(readFileSync(join(vendorRoot, 'manifest.json'), 'utf8'));
  const entries = Object.entries(manifest.files);
  assert.ok(entries.length > 0, 'the vendored manifest must list files');
  for (const [rel, sha] of entries) {
    const content = readFileSync(join(vendorRoot, rel), 'utf8').replace(/\r\n/g, '\n');
    const actual = createHash('sha256').update(content).digest('hex');
    assert.equal(actual, sha, `vendored file drifted from harness-kit ${manifest.kitVersion}: ${rel}`);
  }
});

test('vendored harness-kit tree has no files outside the manifest', () => {
  const manifest = JSON.parse(readFileSync(join(vendorRoot, 'manifest.json'), 'utf8'));
  const expected = new Set([...Object.keys(manifest.files), 'manifest.json']);
  const actual = walk(vendorRoot).map((path) => relative(vendorRoot, path).split('\\').join('/'));
  assert.deepEqual([...actual].sort(), [...expected].sort(), 'vendor/harness-kit must contain exactly the manifest files');
});
