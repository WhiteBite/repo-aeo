/**
 * Axis 3 — Agent readiness: AGENTS.md presence, tested commands, do/don't rules.
 * Coding agents (Codex, Cursor, OpenCode, Claude Code) read AGENTS.md as the
 * project instruction file, so it must contain commands that actually work.
 */
import { check, finding, skip } from './_shared.js';
import { exists, readTextIfExists } from '../../util/fs.js';
import { join } from 'node:path';
function agentsText(ctx) {
  return ctx.agentsMd ?? readTextIfExists(join(ctx.cwd, 'AGENTS.md'));
}

const COMMAND_RE = /\b(test|lint|format|build|typecheck|dev|start|install|ci)\b/i;

function scriptsOf(pkg) {
  if (!pkg || typeof pkg.scripts !== 'object' || pkg.scripts === null) return {};
  return pkg.scripts;
}

function hasScriptFamily(scripts, family) {
  return Object.keys(scripts).some((name) => name === family || name.startsWith(`${family}:`));
}

function requiredCommandWords(pkg, quickstart) {
  const scripts = scriptsOf(pkg);
  const required = [];
  if (hasScriptFamily(scripts, 'test') || (quickstart && quickstart.test)) required.push('test');
  if (hasScriptFamily(scripts, 'lint')) required.push('lint');
  if (hasScriptFamily(scripts, 'build')) required.push('build');
  return required;
}

export const agentsChecks = [
  check({
    id: 'agents.exists',
    axis: 'agents',
    weight: 15,
    title: 'AGENTS.md exists at the repository root',
    why: 'AGENTS.md is the operational instruction file that coding agents load automatically. Without it, agents guess how to run tests and lint, and usually guess wrong.',
    fix: 'Run `rdk init` (or `rdk fix`) to create a draft AGENTS.md, then review it by hand.',
    effort: 'S',
    autoFixable: true,
    patchId: 'agents.stub',
    run(ctx) {
      if (!exists(join(ctx.cwd, 'AGENTS.md'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'AGENTS.md is missing', why: this.why, fix: this.fix, effort: 'S' });
      }
      const text = agentsText(ctx);
      if (text.trim().length < 120) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'AGENTS.md is too thin to be useful', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'agents.commands',
    axis: 'agents',
    weight: 15,
    title: 'AGENTS.md documents test, lint and build commands',
    why: 'An agent that cannot run the project checks cannot verify its own changes, which is exactly how hallucinated "fixes" get committed.',
    fix: 'Add a "## Commands" section with the exact commands (npm test, npm run lint, npm run build).',
    effort: 'S',
    autoFixable: true,
    patchId: 'agents.stub',
    run(ctx) {
      const text = agentsText(ctx);
      if (text === null) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'AGENTS.md is missing, so agents have no verified commands', why: this.why, fix: 'Run `rdk init`.', effort: 'S' });
      }
      const required = requiredCommandWords(ctx.pkg, ctx.config.quickstart);
      if (required.length === 0) return skip('no test/lint/build scripts or quickstart commands to document');
      const lower = text.toLowerCase();
      const missing = required.filter((word) => !lower.includes(word));
      if (missing.length === required.length) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: `AGENTS.md does not document: ${required.join(', ')}`, why: this.why, fix: this.fix, effort: 'S' });
      }
      if (missing.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `AGENTS.md does not mention: ${missing.join(', ')}`, why: this.why, fix: this.fix, effort: 'S' });
      }
      if (!COMMAND_RE.test(text)) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'AGENTS.md mentions checks but no explicit commands', why: this.why, fix: 'Prefer explicit shell commands over prose.', effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'agents.scripts_match',
    axis: 'agents',
    weight: 8,
    title: 'Commands referenced in AGENTS.md exist in package.json',
    why: 'Documented commands that do not exist are worse than no documentation: the agent fails, retries, and burns context.',
    fix: 'Align AGENTS.md with the scripts in package.json (or add the missing scripts).',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const text = agentsText(ctx);
      const scripts = scriptsOf(ctx.pkg);
      if (text === null || Object.keys(scripts).length === 0) return null;
      const referenced = [...text.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([a-z0-9:_-]+)/gi)].map((m) => m[1]);
      const missing = [...new Set(referenced)].filter((name) => !Object.hasOwn(scripts, name));
      if (missing.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `AGENTS.md references missing scripts: ${missing.join(', ')}`, why: this.why, fix: this.fix, effort: 'S' });
      }
      const testScript = scripts.test || scripts['test:unit'];
      if (testScript && !new RegExp(`\\b(test)\\b`).test(text)) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'package.json has a test script but AGENTS.md does not mention how to run it', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'agents.do_dont',
    axis: 'agents',
    weight: 7,
    title: 'AGENTS.md contains explicit do / don\'t rules',
    why: 'Do/don\'t rules are the cheapest guardrails: they stop agents from reformatting unrelated files, bumping versions or publishing by accident.',
    fix: 'Add a "## Do / Don\'t" section (e.g. "don\'t commit generated files", "don\'t bump the version").',
    effort: 'S',
    autoFixable: true,
    patchId: 'agents.stub',
    run(ctx) {
      const text = agentsText(ctx);
      if (text === null) return null;
      const lower = text.toLowerCase();
      const hasDo = /\b(do|always|prefer)\b/.test(lower);
      const hasDont = /\b(don'?t|do not|never|avoid)\b/.test(lower);
      if (!hasDo || !hasDont) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'AGENTS.md lacks explicit do/don\'t guidance', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'agents.map_of_important_files',
    axis: 'agents',
    weight: 5,
    title: 'AGENTS.md maps important files and directories',
    why: 'A short repository map lets an agent navigate in one hop instead of grepping the whole tree.',
    fix: 'Add a "## Repository map" section listing the key directories and their purpose.',
    effort: 'S',
    autoFixable: true,
    patchId: 'agents.stub',
    run(ctx) {
      const text = agentsText(ctx);
      if (text === null) return null;
      const hasMap = /\b(packages\/|src\/|docs\/|repository map|layout|structure)\b/i.test(text);
      if (!hasMap) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'AGENTS.md has no repository map', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),
];
