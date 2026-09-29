/**
 * Where things live, derived instead of hard-coded.
 *
 * The tool is published from one repository, but it audits *other* people's
 * repositories, so any URL that ends up inside a generated file must come from
 * the repository being audited — never from this project's constants. Those
 * constants only describe the tool itself (report footers, user agents, the
 * documentation link in a generated config).
 */
import { gitInfo, parseRemote } from './git.js';

/** Canonical home of this tool. */
export const TOOL_HOME = 'https://github.com/WhiteBite/repo-aeo';

/** Owner used when the audited repository has no origin remote to read. */
export const DEFAULT_OWNER = 'WhiteBite';

/**
 * Web URL of the repository being audited, from its origin remote.
 * Falls back to the tool's home when the directory is not a git repository or
 * the remote cannot be parsed (e.g. a tarball export in CI).
 */
export function repoWebUrl(cwd = process.cwd()) {
  const parsed = parseRemote(gitInfo(cwd).remote);
  if (parsed.host && parsed.owner && parsed.repo) {
    return `https://${parsed.host}/${parsed.owner}/${parsed.repo}`;
  }
  return TOOL_HOME;
}

/** Owner (user or organisation) of the repository being audited. */
export function repoOwner(cwd = process.cwd()) {
  const parsed = parseRemote(gitInfo(cwd).remote);
  return parsed.owner || DEFAULT_OWNER;
}

/** Documentation URL for a file in this tool's repository. */
export function toolDocUrl(path = '', ref = 'main') {
  const clean = String(path).replace(/^\/+/, '');
  return `${TOOL_HOME}/blob/${ref}/${clean}`;
}
