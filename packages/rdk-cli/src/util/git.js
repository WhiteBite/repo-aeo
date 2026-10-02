import { run } from './proc.js';

/** Best-effort git facts about the working tree. Returns nulls when not a repo. */
export function gitInfo(cwd = process.cwd()) {
  const inside = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { isRepo: false, remote: null, host: null, owner: null, repo: null, branch: null, hasGh: hasGhCli() };
  }
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd });
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  const url = remote.ok ? remote.stdout.trim() : null;
  const { host, owner, repo } = parseRemote(url);
  return {
    isRepo: true,
    remote: url,
    host,
    owner,
    repo,
    branch: branch.ok ? branch.stdout.trim() : null,
    hasGh: hasGhCli(),
  };
}

const SCHEME_URL = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const GIT_SCHEMES = new Set(['ssh:', 'git:', 'http:', 'https:']);

function parseSchemeUrl(url) {
  if (!SCHEME_URL.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!GIT_SCHEMES.has(parsed.protocol) || !parsed.hostname) return null;
  const path = parsed.pathname.replace(/\/+$/, '').replace(/^\/+/, '').replace(/\.git$/, '');
  const slash = path.indexOf('/');
  if (slash === -1) return null;
  return { host: parsed.hostname, owner: path.slice(0, slash), repo: path.slice(slash + 1) };
}

export function parseRemote(url) {
  if (!url) return { host: null, owner: null, repo: null };
  const scheme = parseSchemeUrl(url);
  if (scheme) return scheme;
  const ssh = /^(?:git@|ssh:\/\/git@)([^/:]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };
  const short = /^(?:github\.com)[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (short) return { host: 'github.com', owner: short[1], repo: short[2] };
  return { host: null, owner: null, repo: null };
}

let ghCliCache = null;

export function hasGhCli() {
  // cached per process: gitInfo runs on every audit and gh is never installed mid-run
  if (ghCliCache === null) ghCliCache = run('gh', ['--version']).ok;
  return ghCliCache;
}

/** Returns the last N commit subjects+bodies for the local secrets heuristic. */
export function recentCommits(cwd = process.cwd(), count = 20) {
  const result = run('git', ['log', `-n`, String(count), '--pretty=format:%H%x1f%s%x1f%b%x1e'], { cwd });
  if (!result.ok) return [];
  return result.stdout
    .split('\u001e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = '', subject = '', body = ''] = chunk.split('\u001f');
      return { hash, subject, body };
    });
}
