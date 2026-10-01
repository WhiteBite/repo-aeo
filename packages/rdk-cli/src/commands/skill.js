/** `rdk skill` — install, remove or inspect the agent skill in harness skill directories. */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'repo-discoverability';

/** The skill ships inside the tarball (prepack copy) and in the repo checkout (dev). */
export function skillSourceDir() {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const candidates = [join(pkgRoot, 'skills', SKILL_NAME), join(pkgRoot, '..', '..', 'skills', SKILL_NAME)];
  return candidates.find((path) => existsSync(join(path, 'SKILL.md'))) || null;
}

export function skillTargets({ cwd = process.cwd(), project = false } = {}) {
  if (process.env.RDK_SKILL_TARGETS) {
    return process.env.RDK_SKILL_TARGETS.split('|').filter(Boolean).map((dir) => ({ harness: 'custom', dir }));
  }
  const home = homedir();
  if (project) {
    return [
      { harness: 'opencode-project', dir: join(cwd, '.opencode', 'skills') },
      { harness: 'claude-project', dir: join(cwd, '.claude', 'skills') },
    ];
  }
  return [
    { harness: 'opencode', dir: join(home, '.config', 'opencode', 'skills') },
    { harness: 'claude', dir: join(home, '.claude', 'skills') },
    { harness: 'codex', dir: join(home, '.codex', 'skills') },
  ];
}

function stateOf(target, source) {
  let stat = null;
  try {
    stat = lstatSync(target);
  } catch {
    return 'absent';
  }
  if (stat.isSymbolicLink()) {
    let dest = null;
    try {
      dest = resolve(dirname(target), readlinkSync(target));
    } catch {
      dest = null;
    }
    return dest === source ? 'linked' : 'foreign-link';
  }
  return 'manual';
}

function act(action, targets, source) {
  const lines = [`# rdk skill ${action}`, ''];
  let ok = true;
  for (const { harness, dir } of targets) {
    const target = join(dir, SKILL_NAME);
    const state = stateOf(target, source);
    if (action === 'status') {
      lines.push(`- ${harness}: ${state} (${dir})`);
      continue;
    }
    if (action === 'uninstall') {
      if (state === 'linked') {
        rmSync(target, { recursive: true, force: true });
        lines.push(`- ${harness}: removed`);
      } else {
        lines.push(`- ${harness}: skipped (${state})`);
      }
      continue;
    }
    if (state === 'linked') {
      lines.push(`- ${harness}: already linked`);
      continue;
    }
    if (state === 'manual' || state === 'foreign-link') {
      lines.push(`- ${harness}: skipped (${state} content present at ${target})`);
      ok = false;
      continue;
    }
    if (!existsSync(dir)) {
      if (!existsSync(dirname(dir))) {
        lines.push(`- ${harness}: skipped (harness not installed)`);
        continue;
      }
      mkdirSync(dir, { recursive: true });
    }
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    lines.push(`- ${harness}: linked`);
  }
  if (action === 'install') {
    lines.push('');
    lines.push(`Source: ${source}`);
    lines.push('Restart the harness (or start a new session) to pick the skill up.');
  }
  return { ok, output: `${lines.join('\n')}\n` };
}

export function skillCommand({ cwd, options = {} }) {
  const action = options.action || 'status';
  if (!['install', 'uninstall', 'status'].includes(action)) {
    return { ok: false, output: `rdk skill: unknown action "${action}" (install | uninstall | status)\n`, exitCode: 1 };
  }
  const source = skillSourceDir();
  if (!source) {
    return { ok: false, output: 'rdk skill: the skill directory is missing from this installation\n', exitCode: 1 };
  }
  const targets = skillTargets({ cwd, project: Boolean(options.project) });
  const { ok, output } = act(action, targets, source);
  return { ok, output, exitCode: ok ? 0 : 1 };
}

export default { skillCommand, skillSourceDir, skillTargets, SKILL_NAME };
