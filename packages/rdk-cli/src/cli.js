/** CLI entry point: argument parsing and command dispatch. */
import { auditCommand } from './commands/audit.js';
import { initCommand } from './commands/init.js';
import { fixCommand } from './commands/fix.js';
import { githubSyncCommand } from './commands/githubSync.js';
import { npmSurfaceCommand } from './commands/npmSurface.js';
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

Common flags:
  --format <json|markdown|github-comment|both>   report format (default markdown)
  --out <path>                                   also write the report to a file
  --online                                       enable link checks + GitHub API reads
  --min-score <n>                                exit 2 when the score is below n
  --apply                                       write changes (required for any write)
  --dry-run                                     preview only (default for fix/init/sync)
  --only <ids>                                   comma-separated patch ids for fix/init
  --skip <ids>                                   comma-separated patch ids to skip
  --repo <owner/name>                            target repository for github-sync
  --ack <string>                                 explicit acknowledgement for writes
  --reason <text>                                auditable reason for writes
  --secrets-depth <n>                            commits scanned for secrets (default 20)
  --no-github                                    skip GitHub API reads even with --online
  --no-pack                                      skip \`npm pack --dry-run\` in npm-surface
  --list                                         list tarball contents in npm-surface
  --cwd <path>                                   run against another directory
  --quiet                                        print only the summary line
  -h, --help                                     show this help
  -v, --version                                  print the CLI version

Safety model:
  Audit is read-only and offline by default. Any write requires an explicit flag:
  \`rdk fix --apply\`, \`rdk init --apply\`, \`rdk github-sync --apply --ack <ACK> --reason "..."\`.
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
      if (next !== undefined && !next.startsWith('-')) {
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

export async function main(argv = process.argv.slice(2), io = {}) {
  const { command, flags } = parseArgs(argv);
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
        const result = await auditCommand({ cwd, options: flags });
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
        const result = npmSurfaceCommand({ cwd, options: flags });
        if (!flags.quiet) log(result.output);
        else log(`npm-surface: ${result.report ? `${result.report.name}@${result.report.version}` : 'no package'}`);
        return result.exitCode;
      }
      case 'github-sync': {
        const loaded = loadConfig(cwd);
        const result = await githubSyncCommand({ cwd, options: flags, config: loaded.config });
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
