/**
 * CLI mode for CI cron jobs and humans who do not want to run an MCP client.
 * Shares the exact same tool implementations as the MCP server, so a weekly
 * cron and an interactive agent can never disagree.
 */
import { findTool, TOOLS } from './tools.js';
import { serve } from './server.js';
import { listMetrics, series } from './history.js';

const USAGE = `repo-aeo-mcp - continuous discoverability monitoring

Usage:
  repo-aeo-mcp serve [--read-only]              run the MCP server on stdio (default)
  repo-aeo-mcp score [--json] [--online]      discoverability score + trend
  repo-aeo-mcp findings [--severity s] [-n 20] audit findings
  repo-aeo-mcp npm-score [package]            npms.io score + gaps + trend
  repo-aeo-mcp github [owner/name]            live GitHub visibility signals
  repo-aeo-mcp github-sync [--apply]          preview/write repo metadata (needs --ack --reason)
  repo-aeo-mcp freshness                      llms.txt drift check
  repo-aeo-mcp site [url]                     /llms.txt check on a domain
  repo-aeo-mcp submissions [--live] [--recommend] distribution campaign ledger + channel recommendations
  repo-aeo-mcp history [metric]               stored metric history
  repo-aeo-mcp tools                          list MCP tool names

Flags: --cwd <path>  --json  --read-only (or RDK_READ_ONLY=1)
`;

function parseFlags(argv) {
  const flags = { json: false, cwd: process.cwd() };
  const positional = [];
  // a leading `-` means the next token is another flag, never this flag's value
  const valueAfter = (i) => {
    const next = argv[i + 1];
    return next !== undefined && !next.startsWith('-') ? next : null;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--online') flags.online = true;
    else if (arg === '--cwd') {
      const value = valueAfter(i);
      if (value !== null) {
        flags.cwd = value;
        i += 1;
      }
    } else if (arg === '-n' || arg === '--limit') {
      const value = valueAfter(i);
      if (value !== null) {
        flags.limit = Number(value);
        i += 1;
      }
    } else if (arg === '--severity') {
      const value = valueAfter(i);
      if (value !== null) {
        flags.severity = value;
        i += 1;
      }
    } else if (arg === '--ack') {
      const value = valueAfter(i);
      if (value !== null) {
        flags.ack = value;
        i += 1;
      }
    } else if (arg === '--reason') {
      const value = valueAfter(i);
      if (value !== null) {
        flags.reason = value;
        i += 1;
      }
    } else if (arg === '--plan-digest') {
      const value = valueAfter(i);
      if (value !== null) {
        flags.planDigest = value;
        i += 1;
      }
    } else if (arg === '--apply') {
      flags.apply = true;
    } else if (arg === '--live') {
      flags.live = true;
    } else if (arg === '--recommend') {
      flags.recommend = true;
    } else if (arg === '--read-only') {
      flags.readOnly = true;
    } else if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/** Writes a payload either as JSON or through its renderer, via the sink. */
function print(payload, { json, render, write }) {
  if (json) {
    write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  write(`${render(payload)}\n`);
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log || ((text) => process.stdout.write(text));
  // Rendered payloads go through the same sink, so tests and callers can
  // capture everything the command prints.
  const write = log;
  const { flags, positional } = parseFlags(argv);
  const command = positional[0] || 'serve';

  if (flags.help || command === 'help') {
    log(USAGE);
    return 0;
  }

  const call = async (toolName, args = {}) => {
    const tool = findTool(toolName);
    if (!tool) throw new Error(`unknown tool ${toolName}`);
    return tool.run({ ...args, cwd: flags.cwd });
  };

  try {
    switch (command) {
      case 'serve':
        await serve({ cwd: flags.cwd, readOnly: flags.readOnly || process.env.RDK_READ_ONLY === '1', input: io.input, output: io.output });
        return 0;

      case 'tools':
        for (const tool of TOOLS) log(`${tool.name}\n`);
        return 0;

      case 'score': {
        // Delegate to the tool instead of calling audit() directly: the tool
        // records the metric, so the trend line here means the same thing as
        // the trend the MCP server reports. Duplicating the engine call is how
        // the two surfaces would drift apart.
        const payload = await call('repo_get_discoverability_score', { online: Boolean(flags.online) });
        const flat = {
          score: payload.score.total,
          grade: payload.score.grade,
          axes: Object.fromEntries(
            Object.entries(payload.score.axes).map(([axis, data]) => [axis, data.applicable ? data.score : null]),
          ),
          errors: payload.summary.errors,
          warnings: payload.summary.warnings,
          autofixable: payload.summary.autofixable,
          checks: `${payload.summary.passedChecks}/${payload.summary.checks}`,
          history_points: payload.history_points,
          trend: payload.trend,
        };
        print(flat, {
          json: flags.json,
          write,
          render: (value) => [
            `Discoverability score: ${value.score}/100 (grade ${value.grade})`,
            `checks passed: ${value.checks} - errors ${value.errors} - warnings ${value.warnings} - autofixable ${value.autofixable}`,
            `trend: ${value.trend.points ? `${value.trend.first} -> ${value.trend.last} (${value.trend.direction})` : 'no history yet'}`,
          ].join('\n'),
        });
        return 0;
      }

      case 'findings': {
        const payload = await call('repo_list_findings', {
          severity: flags.severity,
          limit: flags.limit || 20,
        });
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            value.findings
              .map((finding) => `[${finding.severity}] ${finding.id} (${finding.effort}${finding.autoFixable ? ', autofix' : ''}) - ${finding.fix}`)
              .join('\n') || 'no findings',
        });
        return 0;
      }

      case 'npm-score': {
        const payload = await call('npm_get_search_score', { package_name: positional[1] });
        print(payload, {
          json: flags.json,
          write,
          render: (value) => {
            if (!value.ok) return `npm score unavailable: ${value.error}`;
            const trendLine = value.trend && value.trend.points ? `${value.trend.first} -> ${value.trend.last}` : 'no history yet';
            if (!value.scores) {
              return [
                `${value.package} (${value.source})`,
                `npms.io score unavailable - latest ${value.latest_version || 'unknown'}${value.deprecated ? ', deprecated' : ''}`,
                `trend: ${trendLine}`,
                ...(value.gaps.length ? ['gaps:', ...value.gaps.map((gap) => `  - ${gap}`)] : ['no completeness gaps detected']),
              ].join('\n');
            }
            return [
              `${value.package}: final ${value.final} (quality ${value.quality}, popularity ${value.popularity}, maintenance ${value.maintenance})`,
              `trend: ${trendLine}`,
              ...(value.gaps.length ? ['gaps:', ...value.gaps.map((gap) => `  - ${gap}`)] : ['no completeness gaps detected']),
            ].join('\n');
          },
        });
        return 0;
      }

      case 'github': {
        const payload = await call('github_audit_visibility_signals', { repo: positional[1] });
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            value.ok
              ? [
                  `${value.repo}: ${value.stars} stars, ${value.forks} forks, ${value.topic_count} topics, ${value.open_issues} open issues`,
                  `last push: ${value.days_since_last_push === null ? 'unknown' : `${value.days_since_last_push} days ago`}`,
                  ...(value.findings.length
                    ? value.findings.map((finding) => `  - [${finding.severity}] ${finding.id}: ${finding.fix}`)
                    : ['  no visibility findings']),
                ].join('\n')
              : `github signals unavailable: ${value.error}`,
        });
        return 0;
      }

      case 'github-sync': {
        const payload = await call('github_sync_metadata', {
          repo: positional[1],
          ack: flags.ack,
          reason: flags.reason,
          apply: flags.apply === true,
          plan_digest: flags.planDigest,
        });
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            value.ok
              ? [
                  `${value.dry_run ? 'Dry run' : 'Applied'}: ${value.mutation_count} mutation(s)${value.repo ? ` for ${value.repo}` : ''}`,
                  ...(value.output ? [value.output] : []),
                  ...(value.dry_run ? ['Pass --apply --ack <ACK> --reason "<why>" --plan-digest <PLAN_DIGEST> to write.'] : []),
                ].join('\n')
              : `github-sync refused: ${value.error}`,
        });
        return payload.ok ? 0 : 1;
      }

      case 'freshness': {
        const payload = await call('llms_txt_check_freshness', {});
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            value.ok
              ? `llms.txt is ${value.fresh ? 'fresh' : `stale by ${value.drift_hours}h`} - ${value.recommendation}`
              : `freshness unavailable: ${value.error}`,
        });
        return 0;
      }

      case 'site': {
        const payload = await call('site_check_llms_txt', { url: positional[1] });
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            value.ok
              ? `${value.url}: present (HTTP ${value.status}, ${value.bytes} bytes, first heading "${value.first_heading}")`
              : `${value.url || 'site'}: not reachable - ${value.error || `HTTP ${value.status}`}`,
        });
        return 0;
      }

      case 'submissions': {
        const payload = await call('distribution_check_submissions', { live: flags.live === true, include_recommendations: flags.recommend === true });
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            value.ok
              ? [
                  value.total === 0
                    ? 'no submissions recorded yet'
                    : `${value.total} submission(s): ${Object.entries(value.summary).map(([status, count]) => `${count} ${status}`).join(', ')}`,
                  ...value.submissions.map((entry) =>
                    `  - ${entry.target}: ${entry.status}${entry.live_status ? ` (live ${entry.live_status})` : ''}${entry.pr_url ? ` ${entry.pr_url}` : ''}`),
                  ...(value.recommendations
                    ? ['channels:', ...value.recommendations.channels.map((channel) => `  - ${channel.id}: ${channel.next_action}`)]
                    : []),
                  ...(value.cleanup_forks.length ? [`forks ready to delete: ${value.cleanup_forks.join(', ')}`] : []),
                  ...(value.note ? [value.note] : []),
                ].join('\n')
              : `submissions unavailable: ${value.error}`,
        });
        return 0;
      }

      case 'history': {
        const metric = positional[1];
        const metrics = metric ? [metric] : listMetrics(flags.cwd);
        const payload = Object.fromEntries(metrics.map((name) => [name, series(name, 10, flags.cwd)]));
        print(payload, {
          json: flags.json,
          write,
          render: (value) =>
            Object.keys(value).length === 0
              ? 'no history recorded yet'
              : Object.entries(value)
                  .map(([name, points]) => `${name}: ${points.length} point(s), latest ${points[points.length - 1]?.at ?? 'n/a'}`)
                  .join('\n'),
        });
        return 0;
      }

      default:
        process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    process.stderr.write(`repo-aeo-mcp failed: ${(error && error.stack) || error}\n`);
    return 1;
  }
}
