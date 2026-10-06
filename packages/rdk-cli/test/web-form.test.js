import test from 'node:test';
import assert from 'node:assert/strict';
import { planDigest } from '../src/distribution/guard.js';
import {
  buildPayload,
  describe as describeWebForm,
  execute as executeWebForm,
  plan as planWebForm,
  probe as probeWebForm,
} from '../src/distribution/mechanisms/webForm.js';

const CONFIG = {
  project: {
    name: 'demo-project',
    one_liner: 'A demo project for web-form tests.',
    description: 'A longer description of the demo project.',
    category: 'mcp-server',
  },
};

const URL = 'https://github.com/owner/demo-project';

const CHANNEL = {
  id: 'submit-directory',
  formUrl: 'https://example.com/submit',
  fields: ['name', 'url', 'description', 'category'],
};

test('describe exposes the web-form mechanism contract', () => {
  assert.equal(describeWebForm().id, 'web-form');
  assert.equal(typeof describeWebForm().summary, 'string');
  assert.ok(describeWebForm().summary.length > 0);
});

test('buildPayload maps the declared form fields onto the config facts', () => {
  assert.deepEqual(buildPayload({ config: CONFIG, url: URL, channel: CHANNEL }), {
    name: 'demo-project',
    url: 'https://github.com/owner/demo-project',
    description: 'A longer description of the demo project.',
    category: 'mcp-server',
  });
});

test('buildPayload normalizes field aliases, falls back to the one-liner and leaves unknown fields empty', () => {
  const payload = buildPayload({
    config: { project: { name: 'demo', one_liner: 'Short.' } },
    url: URL,
    channel: { id: 'c', formUrl: 'https://example.com/f', fields: ['Project Name', 'repository_url', 'one-liner', 'email'] },
  });
  assert.deepEqual(payload, {
    'Project Name': 'demo',
    repository_url: 'https://github.com/owner/demo-project',
    'one-liner': 'Short.',
    email: '',
  });
});

test('plan is pure and shapes one item per channel as the digest input', () => {
  const ctx = { channels: [CHANNEL, { id: 'other-form', formUrl: 'https://example.com/other', fields: ['name'] }], config: CONFIG, url: URL };
  const items = planWebForm(ctx);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    target: 'submit-directory',
    formUrl: 'https://example.com/submit',
    payload: buildPayload({ config: CONFIG, url: URL, channel: CHANNEL }),
    url: URL,
  });
  assert.equal(items[1].target, 'other-form');
  assert.deepEqual(planWebForm(ctx), items);
  assert.equal(planDigest(planWebForm(ctx)), planDigest(items));
  assert.notEqual(planDigest(planWebForm({ ...ctx, url: 'https://github.com/other/demo' })), planDigest(items));
  assert.deepEqual(planWebForm({ channels: [], config: CONFIG, url: URL }), []);
  assert.deepEqual(planWebForm({}), []);
});

test('plan falls back to the form URL as the target when the channel has no id', () => {
  const items = planWebForm({ channels: [{ formUrl: 'https://example.com/submit', fields: [] }], config: CONFIG, url: URL });
  assert.equal(items[0].target, 'https://example.com/submit');
});

test('execute prepares a human checklist and never records a submission', () => {
  const [item] = planWebForm({ channels: [CHANNEL], config: CONFIG, url: URL });
  const result = executeWebForm({ item, channel: CHANNEL, cwd: '/tmp/rdk-demo', config: CONFIG });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['checklist', 'lines', 'ok', 'record']);
  assert.ok(result.lines.every((line) => typeof line === 'string'));
  assert.equal(result.record.status, 'prepared');
  assert.equal(result.record.target, 'submit-directory');
  assert.equal(result.record.form_url, 'https://example.com/submit');
  assert.deepEqual(result.record.payload, item.payload);
  assert.equal(result.record.submitted_at, undefined);
  assert.equal(result.record.pr_url, undefined);
  assert.ok(result.checklist.steps.every((step) => typeof step === 'string'));
  assert.ok(result.checklist.steps.some((step) => step.includes('https://example.com/submit')));
  assert.ok(result.checklist.steps.some((step) => step.includes('demo-project')));
  assert.ok(result.checklist.steps.some((step) => /submit the form yourself/i.test(step)));
  assert.ok(result.checklist.steps.some((step) => step.includes('submissions.json')));
  assert.equal(result.checklist.target, 'submit-directory');
  assert.ok(result.lines.some((line) => /not submitted/i.test(line)));
});

test('execute rebuilds the payload from config when the item carries none', () => {
  const result = executeWebForm({ item: { target: 'submit-directory', formUrl: CHANNEL.formUrl, url: URL }, channel: CHANNEL, cwd: '/tmp/rdk-demo', config: CONFIG });
  assert.equal(result.ok, true);
  assert.deepEqual(result.record.payload, buildPayload({ config: CONFIG, url: URL, channel: CHANNEL }));
});

test('execute fails loudly when no form URL is available', () => {
  const result = executeWebForm({ item: { target: 'no-form' }, channel: { id: 'no-form' }, cwd: '/tmp/rdk-demo', config: CONFIG });
  assert.equal(result.ok, false);
  assert.match(result.error, /formUrl/);
  assert.equal(result.record, undefined);
  assert.equal(result.checklist, undefined);
});

test('probe reports no programmatic state for any record', () => {
  assert.deepEqual(probeWebForm({ status: 'prepared', target: 'submit-directory' }), { kind: 'none', ref: null });
  assert.deepEqual(probeWebForm({}), { kind: 'none', ref: null });
  assert.deepEqual(probeWebForm(null), { kind: 'none', ref: null });
});
