/** Compact PR-comment renderer (`rdk audit --format github-comment`). */
import { AXIS_LABELS } from '../audit/score.js';

export const COMMENT_MARKER = '<!-- rdk-discoverability-audit -->';

const SEVERITY_ICON = { error: '🔴', warn: '🟡', info: '🔵' };

function checkbox(finding) {
  return finding.autoFixable ? `- [ ] **autofix available** \`rdk fix\`` : null;
}

export function renderGithubComment(report, { maxFindings = 8 } = {}) {
  const { score, summary, findings } = report;
  const lines = [];
  lines.push(COMMENT_MARKER);
  lines.push(`## Discoverability audit — ${score.total}/100 (grade ${score.grade})`);
  lines.push('');
  lines.push(`\`${report.project.name || 'unknown'}\` · ${summary.passedChecks}/${summary.checks} checks passed · ${summary.errors} errors · ${summary.warnings} warnings · ${summary.info} info`);
  lines.push('');

  lines.push('| Axis | Score |');
  lines.push('| --- | --- |');
  for (const [axis, data] of Object.entries(score.axes)) {
    if (!data.applicable) continue;
    lines.push(`| ${AXIS_LABELS[axis] || axis} | ${data.score}/100 |`);
  }
  lines.push('');

  if (findings.length === 0) {
    lines.push('✅ All applicable discoverability checks pass. Nothing to do.');
    lines.push('');
  } else {
    lines.push('### Top findings');
    lines.push('');
    for (const finding of findings.slice(0, maxFindings)) {
      lines.push(`${SEVERITY_ICON[finding.severity]} **${finding.title}**`);
      lines.push(`   - why: ${truncate(finding.why, 180)}`);
      lines.push(`   - fix: ${truncate(finding.fix, 180)}${finding.autoFixable ? ' _(autofixable)_' : ''}`);
      lines.push('');
    }
    if (findings.length > maxFindings) {
      lines.push(`<details><summary>${findings.length - maxFindings} more findings</summary>`);
      lines.push('');
      for (const finding of findings.slice(maxFindings)) {
        lines.push(`- ${SEVERITY_ICON[finding.severity]} \`${finding.id}\` — ${truncate(finding.title, 120)}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('### Checklist');
  lines.push('');
  const checklist = [
    `- [ ] Fill \`.discoverability/project.yml\` (source of truth)`,
    `- [ ] Review autofixable findings with \`rdk fix --dry-run\``,
    summary.autofixable > 0 ? `- [ ] Apply safe autofixes with \`rdk fix --apply\`` : '- [ ] Apply the manual fixes listed above',
    summary.errors > 0 ? `- [ ] Resolve ${summary.errors} error-level finding(s)` : '- [x] No error-level findings',
    '- [ ] Re-run `rdk audit` and push the updated score',
  ];
  lines.push(...checklist);
  lines.push('');
  lines.push('<sub>Automated by <a href="https://github.com/WhiteBite/signal-forge">Repo Discoverability Kit</a> · audit-only by default, no writes performed</sub>');
  lines.push('');
  return lines.join('\n');
}

function truncate(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export default { renderGithubComment, COMMENT_MARKER };
