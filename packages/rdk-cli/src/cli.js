/** CLI entry point: argument parsing and command dispatch. */
import { auditCommand } from './commands/audit.js';
import { initCommand } from './commands/init.js';
import { fixCommand } from './commands/fix.js';
import { githubSyncCommand } from './commands/githubSync.js';
import { submitCommand } from './commands/submit.js';
import { trackCommand } from './commands/track.js';
import { channelsCommand } from './commands/channels.js';
import { npmSurfaceCommand } from './commands/npmSurface.js';
import { skillCommand } from './commands/skill.js';
import { loadConfig } from './config.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const USAGE = `rdk — Repo Discoverability Kit

Usage:
  rdk init                 Create .discoverability/project.yml + minimal safe files
  rdk audit                Print the Discoverability Score and findings
  rdk fix                  Show (or apply) safe autofixes
  rdk npm-surface          Audit the publishable package.json surface
  rdk github-sync          Push description/homepage/topics to GitHub (needs --apply --ack)
  rdk submit [--channel <id>]  Propose the project to curated lists (needs --apply --ack)
  rdk track [--json] [--adopt] [--sync] [--mark <target> [--channel <id>] --status <status>]  Campaign dashboard: live status, adopt existing PRs, sync the ledger, mark a row's status
  rdk channels             Show every distribution channel, applicability and next action
  rdk skill <install|uninstall|status>  Link the agent skill into harness skill dirs (--project: repo-local)

Common flags:
  --format <json|markdown|github-comment|both>   report format (default markdown)
  --out <path>                                   also write the report to a file
  --online                                       enable link checks + GitHub API reads
  --min-score <n>                                exit 2 when the score is below n
  --apply                                       write changes (required for any write)
  --only <ids>                                   comma-separated patch ids for fix/init
  --skip <ids>                                   comma-separated patch ids to skip
  --repo <owner/name>                            target repository for github-sync
  --targets <owner/name,...>                     curated lists for submit
  --category <heading>                           exact section heading in the target list (submit)
  --entry <markdown line>                        override the generated list entry (submit)
  --position <end|alphabetical>                  entry placement inside the section (submit)
  --search                                       propose candidate curated lists via gh (submit)
  --ack <string>                                 explicit acknowledgement for writes
  --reason <text>                                auditable reason for writes
  --plan-digest <hex>                            plan digest from the github-sync preview; the write is refused if the plan changed
  --secrets-depth <n>                            commits scanned for secrets (default 20)
  --no-github                                    skip GitHub API reads even with --online
  --no-pack                                      skip \`npm pack --dry-run\` in npm-surface
  --list                                         list tarball contents in npm-surface
  --cwd <path>                                   run against another directory
  --quiet                                        print only the summary line
  -h, --help                                     show this help
  -v, --version                                  print the CLI version

Safety model:
  Audit is read-only and offline by default. fix, init, github-sync and submit
  preview by default; any write requires an explicit flag: \`rdk fix --apply\`,
  \`rdk init --apply\`, \`rdk github-sync --apply --ack <ACK> --reason "..."\`,
  \`rdk submit --apply --ack <ACK> --reason "..." --plan-digest <DIGEST>\`.
  Publishing, tagging and force-pushing are never performed by rdk.
`;

function version() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/** Parses argv into { command, flags }. */
export function parseArgs(argv) {
  const args = [...argv];
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') flags.help = true;
    else if (arg === '-v' || arg === '--version') flags.version = true;
    else if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }
      const next = args[i + 1];
      // "- [x]" и одиночный "-" — это значения (markdown-entry, минус), а не флаги
      if (next !== undefined && (!next.startsWith('-') || next === '-' || /^-\s/.test(next))) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0] || 'audit', flags, positional };
}

const POSITIONAL_LIMITS = {
  init: 1,
  audit: 1,
  score: 1,
  fix: 1,
  'npm-surface': 1,
  'github-sync': 1,
  submit: 1,
  channels: 1,
  track: 1,
  skill: 2,
};

function strayArgument(command, flags, positional) {
  const limit = POSITIONAL_LIMITS[command];
  if (limit === undefined) return undefined;
  if (positional.length > limit) return positional[limit];
  // --project is valueless for skill, so a value it swallowed is a hidden stray positional
  if (command === 'skill' && typeof flags.project === 'string') return flags.project;
  return undefined;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const { command, flags, positional } = parseArgs(argv);
  const log = io.log || ((text) => process.stdout.write(`${text}\n`));
  const error = io.error || ((text) => process.stderr.write(`${text}\n`));
  const cwd = flags.cwd ? String(flags.cwd) : process.cwd();

  if (flags.help || command === 'help') {
    log(USAGE);
    return 0;
  }
  if (flags.version || command === 'version') {
    log(version());
    return 0;
  }
  if (positional.length === 0) {
    // a bare `rdk` is a help request; flags without a command are a typo that must not pass CI green
    if (Object.keys(flags).length > 0) {
      error('rdk: no command given (see --help)');
      return 1;
    }
    log(USAGE);
    return 0;
  }

  for (const key of ['minScore', 'secretsDepth']) {
    if (flags[key] === true) {
      error(`rdk: --${key.replace(/([A-Z])/g, '-$1').toLowerCase()} requires a number value (see --help)`);
      return 1;
    }
  }

  const stray = strayArgument(command, flags, positional);
  if (stray !== undefined) {
    error(`rdk: unexpected argument "${stray}" for command "${command}" (see --help)`);
    return 1;
  }

  try {
    switch (command) {
      case 'init': {
        const result = initCommand({ cwd, options: { ...flags, apply: Boolean(flags.apply) } });
        if (!flags.quiet) log(result.output);
        else log(`init: ${result.written.length} file(s) written`);
        return result.ok ? 0 : 1;
      }
      case 'audit':
      case 'score': {
        const result = await auditCommand({ cwd, options: { ...flags, github: flags.noGithub ? false : flags.github } });
        if (!flags.quiet) log(result.output);
        // The summary goes to stderr so stdout stays machine-parseable
        // (`--format json` / `--format github-comment` can be piped directly).
        error(result.summary);
        return result.exitCode;
      }
      case 'fix': {
        const result = fixCommand({ cwd, options: flags });
        if (!flags.quiet) log(result.output);
        else log(`fix: ${result.written.length} file(s) written`);
        return result.ok ? 0 : 1;
      }
      case 'npm-surface': {
        const result = npmSurfaceCommand({ cwd, options: { ...flags, pack: flags.noPack ? false : flags.pack } });
        if (result.summary) error(result.summary);
        if (!flags.quiet) log(result.output);
        else log(`npm-surface: ${result.report ? `${result.report.name}@${result.report.version}` : 'no package'}`);
        return result.exitCode;
      }
      case 'github-sync': {
        const loaded = loadConfig(cwd);
        const result = await githubSyncCommand({ cwd, options: { ...flags, plan_digest: flags.planDigest }, config: loaded.config });
        if (!flags.quiet) log(result.output);
        return result.exitCode;
      }
      case 'submit': {
        const loaded = loadConfig(cwd);
        const result = await submitCommand({ cwd, loaded, options: { ...flags, plan_digest: flags.planDigest }, config: loaded.config });
        if (!flags.quiet) log(result.output);
        return result.exitCode;
      }
      case 'track': {
        const loaded = loadConfig(cwd);
        const result = await trackCommand({ cwd, options: { ...flags, plan_digest: flags.planDigest }, config: loaded.config });
        if (!flags.quiet) log(result.output);
        return result.exitCode;
      }
      case 'channels': {
        const loaded = loadConfig(cwd);
        const result = channelsCommand({ cwd, loaded });
        if (!flags.quiet) log(result.output);
        return result.exitCode;
      }
      case 'skill': {
        const result = skillCommand({ cwd, options: { ...flags, action: positional[1] || 'status' } });
        if (!flags.quiet) log(result.output);
        return result.exitCode;
      }
      default:
        error(`Unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    error(`rdk failed: ${(err && err.stack) || err}`);
    return 1;
  }
}
