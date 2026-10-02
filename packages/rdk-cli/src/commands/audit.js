/** `rdk audit` — collect facts, run checks, render the report. */
import { isAbsolute, resolve } from 'node:path';
import { audit } from '../audit/index.js';
import { renderMarkdownReport } from '../report/markdown.js';
import { renderGithubComment } from '../report/githubComment.js';
import { writeText } from '../util/fs.js';

export async function auditCommand({ cwd, options = {} }) {
  const minScore = options.minScore === undefined || options.minScore === null ? undefined : Number(options.minScore);
  if (Number.isNaN(minScore)) {
    return {
      ok: false,
      report: null,
      output: '',
      summary: `rdk: --min-score must be a number, got ${JSON.stringify(String(options.minScore))}`,
      exitCode: 1,
    };
  }
  const secretsDepth = options.secretsDepth === undefined || options.secretsDepth === null ? undefined : Number(options.secretsDepth);
  if (secretsDepth !== undefined && (!Number.isFinite(secretsDepth) || secretsDepth < 1)) {
    return {
      ok: false,
      report: null,
      output: '',
      summary: `rdk: --secrets-depth must be a positive number, got ${JSON.stringify(String(options.secretsDepth))}`,
      exitCode: 1,
    };
  }

  const format = options.format === undefined || options.format === null ? 'markdown' : options.format;
  if (typeof format !== 'string' || !['json', 'markdown', 'github-comment', 'both'].includes(format)) {
    return {
      ok: false,
      report: null,
      output: '',
      summary: `rdk: --format must be one of json|markdown|github-comment|both, got ${JSON.stringify(String(options.format))}`,
      exitCode: 1,
    };
  }

  const report = await audit(cwd, {
    online: Boolean(options.online),
    secretsDepth: options.secretsDepth,
    github: options.github,
    linkTimeout: options.linkTimeout,
  });

  let output;
  if (format === 'json') {
    output = `${JSON.stringify(report, null, 2)}\n`;
  } else if (format === 'github-comment') {
    output = renderGithubComment(report);
  } else if (format === 'both') {
    output = `${renderMarkdownReport(report)}\n\n---\n\n${renderGithubComment(report)}`;
  } else {
    output = renderMarkdownReport(report);
  }

  if (options.out) {
    const path = isAbsolute(options.out) ? options.out : resolve(cwd, options.out);
    writeText(path, output);
  }

  const summary = [
    `score: ${report.score.total}/100 (grade ${report.score.grade})`,
    `checks: ${report.summary.passedChecks}/${report.summary.checks} passed`,
    `findings: ${report.summary.errors} error, ${report.summary.warnings} warn, ${report.summary.info} info (${report.summary.autofixable} autofixable)`,
    report.environment.offline ? 'mode: offline (use --online for link + GitHub checks)' : 'mode: online',
  ].join(' · ');

  return { ok: true, report, output, summary, exitCode: minScore !== undefined && report.score.total < minScore ? 2 : 0 };
}

export default { auditCommand };
