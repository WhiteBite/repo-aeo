/**
 * The git-pr mechanism: fork the target repository, insert the artifact into
 * its README on a dedicated branch, push to the fork and open a pull request.
 * Runners are injected, so the whole flow is offline-testable.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeHeading } from '../../audit/checks/_shared.js';

export function describe() {
  return {
    id: 'git-pr',
    summary: 'Fork the target repository, insert the artifact on a dedicated branch and open a pull request.',
  };
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

/** Builds the per-target plan items; pure, and the direct input of the plan digest. */
export function plan({ targets, category, position, entry, name, url }) {
  return targets.map((target) => {
    const listRepo = target.split('/')[1];
    return { target, category, position, entry, title: `Add ${name}`, branch: `rdk/${listRepo}/add-${slug(name)}`, project: name, url };
  });
}

function prBody(item) {
  return `Adds ${item.project} to "${item.category}".\n\n${item.entry}\n\nRepository: ${item.url}\n`;
}

/**
 * Executes one plan item end to end. Returns { ok, lines, record } on success
 * and { ok: false, error, lines } on failure; lines are the output block for
 * this target, in order, so the caller can splice them into its report.
 */
export function execute({ item, owner, gh, git }) {
  const lines = ['', `## ${item.target}`];
  const fail = (error) => ({ ok: false, error, lines });
  const listRepo = item.target.split('/')[1];
  const fork = `${owner}/${listRepo}`;
  const forked = gh(['repo', 'fork', item.target, '--clone=false']);
  if (!forked.ok) {
    lines.push(`❌ fork failed: ${forked.stderr.trim().slice(0, 200)}`);
    return fail(`failed to fork ${item.target}: ${forked.stderr.trim().slice(0, 200)}`);
  }
  const work = mkdtempSync(join(tmpdir(), 'rdk-submit-'));
  try {
    const clone = git(['clone', '--depth=1', `https://github.com/${item.target}.git`, work], { timeout: 120000 });
    if (!clone.ok) {
      lines.push(`❌ clone failed: ${clone.stderr.trim().slice(0, 200)}`);
      return fail(`failed to clone ${item.target}: ${clone.stderr.trim().slice(0, 200)}`);
    }
    const readmePath = join(work, 'README.md');
    if (!existsSync(readmePath)) {
      lines.push('❌ README.md not found at the repository root.');
      return fail(`${item.target}: README.md not found at the repository root`);
    }
    const readme = readFileSync(readmePath, 'utf8');
    if (readme.includes(item.url)) {
      lines.push(`❌ ${item.target} already lists ${item.url}.`);
      return fail(`${item.target} already lists ${item.url} - search the list before submitting`);
    }
    const insert = insertEntryIntoReadme(readme, item.category, item.entry, item.position);
    if (!insert.ok) {
      lines.push(`❌ ${insert.error}`);
      return fail(`${item.target}: ${insert.error}`);
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
        return fail(`${item.target}: git ${stepArgs[0]} failed: ${step.stderr.trim().slice(0, 200)}`);
      }
    }
    const pr = gh(['pr', 'create', '-R', item.target, '--head', `${owner}:${item.branch}`, '--title', item.title, '--body', prBody(item)]);
    if (!pr.ok) {
      lines.push(`❌ gh pr create failed: ${pr.stderr.trim().slice(0, 200)}`);
      return fail(`${item.target}: gh pr create failed: ${pr.stderr.trim().slice(0, 200)}`);
    }
    const prUrl = pr.stdout.trim().split('\n').pop().trim();
    lines.push(`✅ ${prUrl}`);
    return {
      ok: true,
      lines,
      record: { target: item.target, pr_url: prUrl, branch: item.branch, fork, submitted_at: new Date().toISOString(), status: 'open' },
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** How to probe a record's live state: the PR URL through the gh CLI. */
export function probe(record) {
  const ref = record && typeof record.pr_url === 'string' && record.pr_url !== '' ? record.pr_url : null;
  return { kind: 'gh-pr', ref };
}
