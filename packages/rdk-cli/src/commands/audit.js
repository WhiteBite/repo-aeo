/** `rdk audit` — collect facts, run checks, render the report. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { audit } from '../audit/index.js';
import { renderMarkdownReport } from '../report/markdown.js';
import { renderGithubComment } from '../report/githubComment.js';

export async function auditCommand({ cwd, options = {} }) {
  const report = await audit(cwd, {
    online: Boolean(options.online),
    secretsDepth: options.secretsDepth,
    github: options.github,
    linkTimeout: options.linkTimeout,
  });

  const format = options.format || 'markdown';
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
    const path = join(cwd, options.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output, 'utf8');
  }

  const summary = [
    `score: ${report.score.total}/100 (grade ${report.score.grade})`,
    `checks: ${report.summary.passedChecks}/${report.summary.checks} passed`,
    `findings: ${report.summary.errors} error, ${report.summary.warnings} warn, ${report.summary.info} info (${report.summary.autofixable} autofixable)`,
    report.environment.offline ? 'mode: offline (use --online for link + GitHub checks)' : 'mode: online',
  ].join(' · ');

  return { ok: true, report, output, summary, exitCode: options.minScore && report.score.total < Number(options.minScore) ? 2 : 0 };
}

export default { auditCommand };
