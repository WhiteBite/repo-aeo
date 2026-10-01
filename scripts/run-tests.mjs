import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const targets = process.argv.slice(2);
const dirs = targets.length > 0 ? targets : ['packages/rdk-cli/test', 'packages/repo-aeo-mcp/test'];
const files = dirs
  .flatMap((dir) => readdirSync(dir).filter((file) => file.endsWith('.test.js')).map((file) => join(dir, file)))
  .sort();

if (files.length === 0) {
  console.error(`no test files found in: ${dirs.join(', ')}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
