/**
 * `rdk submit` — propose the project to curated lists (awesome lists and the
 * like). Previews the whole campaign by default; opening pull requests needs
 * the same guard chain as github-sync: --apply --ack --reason --plan-digest.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { run } from '../util/proc.js';
import { effectiveAck, planDigest, resolveRepo } from './githubSync.js';
import { normalizeHeading } from '../audit/checks/_shared.js';

const ACK_HINT =
  'the acknowledgement string configured for this repository (safety.ack in .discoverability/project.yml; the default is documented in the package README)';

const TARGET_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const BLOCKING_STATUSES = new Set(['prepared', 'open', 'merged', 'closed']);

export function submissionsPath(cwd = process.cwd()) {
  return join(cwd, '.discoverability', 'submissions.json');
}

/** Reads the campaign ledger; null means present but unparsable (committed state, never auto-repaired). */
export function readSubmissions(cwd = process.cwd()) {
  const path = submissionsPath(cwd);
  if (!existsSync(path)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

export function buildEntry({ name, url, oneLiner, entry }) {
  if (entry) return String(entry);
  const text = String(oneLiner || '').trim();
  return `- [${name}](${url}) — ${text.endsWith('.') ? text : `${text}.`}`;
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function listItemName(line) {
  const match = /^[-*]\s*\[([^\]]+)\]/.exec(String(line));
  return match ? match[1].toLowerCase() : null;
}

/** Inserts one entry line into a section of a curated list's README. Pure, so it is unit-testable offline. */
export function insertEntryIntoReadme(readme, category, entry, position = 'end') {
  const lines = String(readme).split(/\r?\n/);
  const wanted = normalizeHeading(category);
  let headingIdx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (match && normalizeHeading(match[2]) === wanted) {
      headingIdx = i;
      level = match[1].length;
      break;
    }
  }
  if (headingIdx === -1) return { ok: false, error: `category "${category}" not found in the list README` };
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[i]);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  if (position === 'alphabetical') {
    const entryName = listItemName(entry);
    if (entryName === null) return { ok: false, error: 'an alphabetical entry must start with "- [Name]"' };
    let insertAt = end;
    for (let i = headingIdx + 1; i < end; i += 1) {
      const name = listItemName(lines[i]);
      if (name === null) continue;
      if (name === entryName) return { ok: false, error: `an entry named "${entryName}" already exists in "${category}"` };
      if (name > entryName) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, entry);
  } else {
    let insertAt = end;
    while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1;
    lines.splice(insertAt, 0, entry);
  }
  return { ok: true, readme: lines.join('\n') };
}

function parseTargets(option) {
  const raw = Array.isArray(option) ? option.map(String) : typeof option === 'string' && option !== '' ? option.split(',') : [];
  return raw.map((target) => String(target).trim()).filter(Boolean);
}

function prBody(item) {
  return `Adds ${item.project} to "${item.category}".\n\n${item.entry}\n\nRepository: ${item.url}\n`;
}

export async function submitCommand({ cwd, options = {}, config, ghRunner, gitRunner }) {
  const gh = ghRunner || ((args, opts = {}) => run('gh', args, { cwd: (opts && opts.cwd) || cwd, timeout: (opts && opts.timeout) || 20000 }));
  const git = gitRunner || ((args, opts = {}) => run('git', args, { cwd: (opts && opts.cwd) || cwd, timeout: (opts && opts.timeout) || 60000 }));
  const lines = ['# rdk submit', ''];
  const fail = (error, extra = {}) => ({ ok: false, error, output: `${lines.join('\n')}\n`, exitCode: 1, applied: [], ...extra });

  if (options.apply) {
    if (String(options.ack || '') !== effectiveAck(config)) {
      lines.push(`Refusing to write: --ack must equal ${ACK_HINT}.`);
      return fail(`refusing to write: --ack must equal ${ACK_HINT}`);
    }
    if (!options.reason || String(options.reason).trim().length < 5) {
      lines.push('Refusing to write: pass --reason "<why this change is correct>" so the change is auditable.');
      return fail('refusing to write: a non-trivial reason is required and is logged');
    }
    if (options.plan_digest === undefined || options.plan_digest === null || String(options.plan_digest).trim() === '') {
      lines.push('Refusing to write: --plan-digest is required so the write binds to the approved preview.');
      return fail('refusing to write: --plan-digest is required - run the dry-run preview first and pass its Plan digest with --plan-digest', { code: 'plan_digest_required' });
    }
  }

  if (options.search) {
    if (!gh(['--version']).ok) {
      lines.push('The GitHub CLI (gh) is required for --search. Install it from https://cli.github.com and run `gh auth login`.');
      return fail('the GitHub CLI (gh) is not installed - install it from https://cli.github.com and run `gh auth login`');
    }
    const keyword = (config.keywords && config.keywords.github_topics && config.keywords.github_topics[0]) || config.project.name;
    const query = `awesome ${keyword}`;
    const result = gh(['search', 'repos', query, '--limit', '10', '--json', 'fullName,stargazersCount,description']);
    if (!result.ok) return fail(`gh search failed: ${result.stderr.trim().slice(0, 200)}`);
    let repos;
    try {
      repos = JSON.parse(result.stdout);
    } catch {
      return fail('could not parse the gh search output');
    }
    lines.push(`Candidates for "${query}":`);
    lines.push('');
    for (const repo of repos) {
      lines.push(`- ${repo.fullName} (${repo.stargazersCount ?? '?'} stars) — ${repo.description || ''}`);
    }
    lines.push('');
    lines.push('Pick from these with --targets owner/name[,owner/name...] after reading each list\'s CONTRIBUTING.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied: [] };
  }

  const targets = parseTargets(options.targets);
  if (targets.length === 0) {
    lines.push('No targets: pass --targets owner/name[,owner/name...] (run with --search to list candidates).');
    return fail('no targets given: pass --targets owner/name[,owner/name...] (run with --search to list candidates)');
  }
  const invalid = targets.filter((target) => !TARGET_RE.test(target));
  if (invalid.length > 0) {
    lines.push(`Invalid target(s) "${invalid.join(', ')}" — expected owner/name.`);
    return fail(`invalid target(s): ${invalid.join(', ')} (expected owner/name)`);
  }
  const category = String(options.category || '').trim();
  if (!category) {
    lines.push('A category is required: pass --category "exact heading text from the list README".');
    return fail('a category is required: pass --category "exact heading text from the list README"');
  }
  const position = options.position === 'alphabetical' ? 'alphabetical' : 'end';

  const repoSlug = resolveRepo(cwd, options);
  const url = repoSlug ? `https://github.com/${repoSlug}` : null;
  if (!url) {
    lines.push('Cannot resolve a GitHub repository URL (no --repo and no github.com origin remote).');
    return fail('cannot resolve a GitHub repository URL (no --repo and no github.com origin remote)');
  }

  const ledger = readSubmissions(cwd);
  if (ledger === null) {
    lines.push('Could not parse .discoverability/submissions.json - fix it by hand or restore it from git.');
    return fail('could not parse .discoverability/submissions.json - fix it by hand or restore it from git');
  }
  const blocked = new Map(
    ledger
      .filter((item) => item && typeof item.target === 'string' && BLOCKING_STATUSES.has(item.status))
      .map((item) => [item.target, item.status]),
  );
  const active = targets.filter((target) => !blocked.has(target));
  for (const target of targets) {
    if (blocked.has(target)) lines.push(`- ${target}: skipped, a ${blocked.get(target)} submission is already recorded`);
  }
  lines.push('');

  if (active.length === 0) {
    lines.push('Every target already has a recorded submission - nothing to do.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: [], plan_digest: null, applied: [] };
  }

  const name = config.project.name || 'project';
  const entry = buildEntry({ name, url, oneLiner: config.project.one_liner || config.project.description, entry: options.entry });
  const plan = active.map((target) => {
    const listRepo = target.split('/')[1];
    return { target, category, position, entry, title: `Add ${name}`, branch: `rdk/${listRepo}/add-${slug(name)}`, project: name, url };
  });
  const digest = planDigest(plan);

  if (options.apply && String(options.plan_digest) !== digest) {
    lines.push('Refusing to write: the plan changed since the approved preview (plan_digest mismatch).');
    return fail('refusing to write: plan_digest mismatch - re-run the preview and approve the new plan', { code: 'plan_digest_mismatch', plan_digest: digest });
  }

  lines.push(`Project: ${name} (${url})`);
  lines.push('');
  for (const item of plan) {
    lines.push(`- **${item.target}**`);
    lines.push(`  - entry:    ${item.entry}`);
    lines.push(`  - section:  ${item.category} (${position})`);
    lines.push(`  - branch:   ${item.branch}`);
    lines.push(`  - PR title: ${item.title}`);
  }
  lines.push('');

  if (!options.apply) {
    lines.push(`Plan digest: ${digest}`);
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>" --plan-digest <PLAN_DIGEST>` to open the pull requests.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan, plan_digest: digest, applied: [] };
  }

  if (!gh(['--version']).ok) {
    lines.push('The GitHub CLI (gh) is required to open pull requests. Install it from https://cli.github.com and run `gh auth login`.');
    return fail('the GitHub CLI (gh) is not installed - install it from https://cli.github.com and run `gh auth login`');
  }
  const login = gh(['api', 'user', '-q', '.login']);
  if (!login.ok || login.stdout.trim() === '') {
    lines.push('Could not resolve the GitHub login - run `gh auth status`.');
    return fail('could not resolve the GitHub login - run `gh auth status`');
  }
  const owner = login.stdout.trim();
  lines.push(`Fork owner: ${owner}`);

  const applied = [];
  for (const item of plan) {
    lines.push('');
    lines.push(`## ${item.target}`);
    const listRepo = item.target.split('/')[1];
    const fork = `${owner}/${listRepo}`;
    const forked = gh(['repo', 'fork', item.target, '--clone=false']);
    if (!forked.ok) {
      lines.push(`❌ fork failed: ${forked.stderr.trim().slice(0, 200)}`);
      return fail(`failed to fork ${item.target}: ${forked.stderr.trim().slice(0, 200)}`, { applied });
    }
    const work = mkdtempSync(join(tmpdir(), 'rdk-submit-'));
    try {
      const clone = git(['clone', '--depth=1', `https://github.com/${item.target}.git`, work], { timeout: 120000 });
      if (!clone.ok) {
        lines.push(`❌ clone failed: ${clone.stderr.trim().slice(0, 200)}`);
        return fail(`failed to clone ${item.target}: ${clone.stderr.trim().slice(0, 200)}`, { applied });
      }
      const readmePath = join(work, 'README.md');
      if (!existsSync(readmePath)) {
        lines.push('❌ README.md not found at the repository root.');
        return fail(`${item.target}: README.md not found at the repository root`, { applied });
      }
      const readme = readFileSync(readmePath, 'utf8');
      if (readme.includes(item.url)) {
        lines.push(`❌ ${item.target} already lists ${item.url}.`);
        return fail(`${item.target} already lists ${item.url} - search the list before submitting`, { applied });
      }
      const insert = insertEntryIntoReadme(readme, item.category, item.entry, item.position);
      if (!insert.ok) {
        lines.push(`❌ ${insert.error}`);
        return fail(`${item.target}: ${insert.error}`, { applied });
      }
      writeFileSync(readmePath, insert.readme);
      const steps = [
        ['checkout', '-b', item.branch],
        ['add', 'README.md'],
        ['commit', '-m', item.title],
        ['push', `https://github.com/${fork}.git`, `${item.branch}:${item.branch}`],
      ];
      for (const stepArgs of steps) {
        const step = git(['-C', work, ...stepArgs]);
        if (!step.ok) {
          lines.push(`❌ git ${stepArgs[0]} failed: ${step.stderr.trim().slice(0, 200)}`);
          return fail(`${item.target}: git ${stepArgs[0]} failed: ${step.stderr.trim().slice(0, 200)}`, { applied });
        }
      }
      const pr = gh(['pr', 'create', '-R', item.target, '--head', `${owner}:${item.branch}`, '--title', item.title, '--body', prBody(item)]);
      if (!pr.ok) {
        lines.push(`❌ gh pr create failed: ${pr.stderr.trim().slice(0, 200)}`);
        return fail(`${item.target}: gh pr create failed: ${pr.stderr.trim().slice(0, 200)}`, { applied });
      }
      const prUrl = pr.stdout.trim().split('\n').pop().trim();
      applied.push({ target: item.target, pr_url: prUrl, branch: item.branch, fork, submitted_at: new Date().toISOString(), status: 'open' });
      lines.push(`✅ ${prUrl}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const ledgerPath = submissionsPath(cwd);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify([...ledger, ...applied], null, 2)}\n`);
  lines.push('');
  lines.push(`Reason logged: ${options.reason}`);
  lines.push(`Recorded ${applied.length} submission(s) in .discoverability/submissions.json.`);
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan, plan_digest: digest, applied };
}

export default { submitCommand, insertEntryIntoReadme, buildEntry, readSubmissions, submissionsPath };
