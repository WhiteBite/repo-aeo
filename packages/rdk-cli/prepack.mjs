import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', '..', 'skills', 'repo-discoverability');
const dest = join(here, 'skills', 'repo-discoverability');

if (!existsSync(join(source, 'SKILL.md'))) process.exit(0);
rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });
