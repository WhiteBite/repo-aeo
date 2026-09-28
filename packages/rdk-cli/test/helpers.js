import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** Creates a temporary repository with the given files and returns its path. */
export function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-test-'));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return dir;
}

export function removeRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export const fixturePath = (...parts) => join(process.cwd(), 'fixtures', 'demo-repo', ...parts);
