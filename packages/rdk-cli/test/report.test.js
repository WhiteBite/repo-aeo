import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit/index.js';
import { renderMarkdownReport } from '../src/report/markdown.js';
import { renderGithubComment, COMMENT_MARKER } from '../src/report/githubComment.js';
import { fixturePath } from './helpers.js';

test('markdown report contains the score, axes and per-finding guidance', async () => {
  const report = await audit(fixturePath(), {});
  const markdown = renderMarkdownReport(report);
  assert.match(markdown, /# Discoverability audit/);
  assert.match(markdown, /\*\*Score: \d+\/100/);
  assert.match(markdown, /\| GitHub metadata \|/);
  assert.match(markdown, /\*\*why:\*\*/);
  assert.match(markdown, /\*\*fix:\*\*/);
  assert.match(markdown, /## Suggested patch order/);
});

test('github comment is compact, marked for updates and contains a checklist', async () => {
  const report = await audit(fixturePath(), {});
  const comment = renderGithubComment(report);
  assert.ok(comment.startsWith(COMMENT_MARKER));
  assert.match(comment, /### Checklist/);
  assert.match(comment, /- \[ \]/);
  assert.ok(comment.length < 6000, 'the PR comment must stay short');
  assert.doesNotMatch(comment, /undefined/);
});

test('json report is serialisable and stable in shape', async () => {
  const report = await audit(fixturePath(), {});
  const clone = JSON.parse(JSON.stringify(report));
  assert.equal(clone.schema, 'rdk-audit/1');
  assert.equal(typeof clone.score.total, 'number');
  assert.ok(Array.isArray(clone.findings));
  for (const finding of clone.findings) {
    for (const key of ['id', 'axis', 'severity', 'title', 'why', 'fix', 'effort', 'autoFixable']) {
      assert.ok(key in finding, `finding ${finding.id} is missing ${key}`);
    }
  }
});
