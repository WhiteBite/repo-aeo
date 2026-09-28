import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export function exists(path) {
  return existsSync(path);
}

/** Modification time in ms, or null when the path does not exist. */
export function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

/** Reads a JSON file, returning null when missing or invalid. */
export function readJsonIfExists(path) {
  const text = readTextIfExists(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Lists files under a directory (non-recursive by default), skipping node_modules and dot-dirs. */
export function listFiles(dir, { recursive = false, maxDepth = 3 } = {}) {
  const out = [];
  const walk = (current, depth) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && depth < maxDepth) walk(full, depth + 1);
        continue;
      }
      out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir, 0);
  return out;
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function rel(from, to) {
  return relative(from, to);
}
