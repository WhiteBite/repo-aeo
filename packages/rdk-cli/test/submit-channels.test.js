import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { submitCommand } from '../src/commands/submit.js';
import { renderServerJson } from '../src/distribution/artifacts/serverJson.js';
import { loadConfig } from '../src/config.js';
import { makeRepo, removeRepo } from './helpers.js';

const PROJECT_YML = [
  'project:',
  '  name: "demo-project"',
  '  one_liner: "A demo project for channel submit tests."',
  '  category: mcp-server',
].join('\n');

const PKG = { name: 'demo-project', version: '1.2.3', description: 'Demo package for channel submit tests.' };

const GUARDS = { apply: true, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test submission' };

function repo() {
  const dir = makeRepo({ '.discoverability/project.yml': PROJECT_YML, 'package.json': JSON.stringify(PKG) });
  const loaded = loadConfig(dir);
  return { dir, config: loaded.config, loaded };
}

test('--channel mcp-official-registry previews offline and applies through the injected fetchImpl', async () => {
  const { dir, config, loaded } = repo();
  try {
    const preview = await submitCommand({ cwd: dir, options: { channel: 'mcp-official-registry' }, config, loaded });
    assert.equal(preview.ok, true);
    assert.equal(preview.exitCode, 0);
    assert.match(preview.output, /- \*\*mcp-official-registry\*\*/);
    assert.match(preview.output, /endpoint: https:\/\/registry\.modelcontextprotocol\.io\/v0\/servers/);
    assert.match(preview.output, /method: POST/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(preview.applied.length, 0);

    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      return { ok: true, status: 201, text: async () => JSON.stringify({ url: 'https://registry.modelcontextprotocol.io/v0/servers/demo-project' }) };
    };
    const hadToken = Object.hasOwn(process.env, 'MCP_REGISTRY_TOKEN');
    const prevToken = process.env.MCP_REGISTRY_TOKEN;
    process.env.MCP_REGISTRY_TOKEN = 'stub-token';
    try {
      const result = await submitCommand({
        cwd: dir,
        options: { ...GUARDS, channel: 'mcp-official-registry', plan_digest: preview.plan_digest },
        config,
        loaded,
        fetchImpl,
      });
      assert.equal(result.ok, true, result.output);
      assert.equal(result.applied.length, 1);
      assert.equal(result.applied[0].mechanism, 'http-json');
      assert.equal(result.applied[0].channel, 'mcp-official-registry');
      assert.equal(result.applied[0].status, 'submitted');
      assert.equal(result.applied[0].dedupe_key, 'mcp-official-registry:mcp-official-registry');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://registry.modelcontextprotocol.io/v0/servers');
      assert.equal(calls[0].init.method, 'POST');
      assert.deepEqual(JSON.parse(calls[0].init.body), renderServerJson(config, loaded.pkg));
      const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].mechanism, 'http-json');
      assert.equal(ledger[0].status, 'submitted');
    } finally {
      if (hadToken) process.env.MCP_REGISTRY_TOKEN = prevToken;
      else delete process.env.MCP_REGISTRY_TOKEN;
    }
  } finally {
    removeRepo(dir);
  }
});

test('--channel mcp-directory-form returns a prepared record with the checklist and records it', async () => {
  const { dir, config, loaded } = repo();
  try {
    const preview = await submitCommand({ cwd: dir, options: { channel: 'mcp-directory-form', repo: 'owner/demo' }, config, loaded });
    assert.equal(preview.ok, true);
    assert.match(preview.output, /- \*\*mcp-directory-form\*\*/);
    assert.match(preview.output, /formUrl: https:\/\/mcp\.so\/submit\?type=server/);

    const result = await submitCommand({
      cwd: dir,
      options: { ...GUARDS, channel: 'mcp-directory-form', repo: 'owner/demo', plan_digest: preview.plan_digest },
      config,
      loaded,
    });
    assert.equal(result.ok, true, result.output);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].status, 'prepared');
    assert.equal(result.applied[0].mechanism, 'web-form');
    assert.equal(result.applied[0].dedupe_key, 'mcp-directory-form:mcp-directory-form');
    assert.match(result.output, /Form: https:\/\/mcp\.so\/submit\?type=server/);
    assert.match(result.output, /Fill "name" with: demo-project/);
    assert.match(result.output, /Fill "url" with: https:\/\/github\.com\/owner\/demo/);
    assert.match(result.output, /a human must fill and submit the form/);
    const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].status, 'prepared');
    assert.equal(ledger[0].mechanism, 'web-form');
  } finally {
    removeRepo(dir);
  }
});

test('--channel npm-registry records prepared and never runs a publish', async () => {
  const { dir, config, loaded } = repo();
  const boom = () => {
    throw new Error('runner must not be called');
  };
  try {
    const preview = await submitCommand({ cwd: dir, options: { channel: 'npm-registry' }, config, loaded, ghRunner: boom, gitRunner: boom, fetchImpl: boom });
    assert.equal(preview.ok, true);
    assert.match(preview.output, /- \*\*npm-registry\*\*/);
    assert.match(preview.output, /artifact: demo-project-1\.2\.3\.tgz/);

    const result = await submitCommand({
      cwd: dir,
      options: { ...GUARDS, channel: 'npm-registry', plan_digest: preview.plan_digest },
      config,
      loaded,
      ghRunner: boom,
      gitRunner: boom,
      fetchImpl: boom,
    });
    assert.equal(result.ok, true, result.output);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].status, 'prepared');
    assert.equal(result.applied[0].mechanism, 'cli-publish');
    assert.equal(result.applied[0].channel, 'npm-registry');
    assert.match(result.output, /prepared - RDK never publishes/);
    const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].status, 'prepared');
    assert.equal(ledger[0].mechanism, 'cli-publish');
  } finally {
    removeRepo(dir);
  }
});

test('--channel skills-sh appends no record', async () => {
  const { dir, config, loaded } = repo();
  try {
    const preview = await submitCommand({ cwd: dir, options: { channel: 'skills-sh' }, config, loaded });
    assert.equal(preview.ok, true);
    assert.match(preview.output, /- \*\*skills-sh\*\*/);
    assert.match(preview.output, /precondition: public-repo/);

    const result = await submitCommand({
      cwd: dir,
      options: { ...GUARDS, channel: 'skills-sh', plan_digest: preview.plan_digest },
      config,
      loaded,
    });
    assert.equal(result.ok, true, result.output);
    assert.equal(result.applied.length, 0);
    assert.match(result.output, /nothing to submit - this channel crawls on its own/);
    assert.equal(existsSync(join(dir, '.discoverability', 'submissions.json')), false);
  } finally {
    removeRepo(dir);
  }
});

test('an unknown --channel fails with a clear error', async () => {
  const { dir, config, loaded } = repo();
  try {
    const result = await submitCommand({ cwd: dir, options: { channel: 'no-such-channel' }, config, loaded });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /unknown channel/);
    assert.match(result.output, /unknown channel/i);
    assert.match(result.output, /rdk channels/);
  } finally {
    removeRepo(dir);
  }
});

test('the ledger skip still applies per channel', async () => {
  const { dir, config, loaded } = repo();
  try {
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, '.discoverability', 'submissions.json'), JSON.stringify([
      { target: 'mcp-official-registry', channel: 'mcp-official-registry', mechanism: 'http-json', status: 'submitted' },
    ]));
    const http = await submitCommand({ cwd: dir, options: { channel: 'mcp-official-registry' }, config, loaded });
    assert.equal(http.ok, true);
    assert.match(http.output, /mcp-official-registry: skipped, a submitted submission is already recorded/);
    assert.match(http.output, /Every target already has a recorded submission - nothing to do\./);
    assert.deepEqual(http.plan, []);

    writeFileSync(join(dir, '.discoverability', 'submissions.json'), JSON.stringify([
      { channel: 'npm-registry', mechanism: 'cli-publish', status: 'prepared' },
    ]));
    const npm = await submitCommand({ cwd: dir, options: { channel: 'npm-registry' }, config, loaded });
    assert.equal(npm.ok, true);
    assert.match(npm.output, /npm-registry: skipped, a prepared submission is already recorded/);
    assert.deepEqual(npm.plan, []);
  } finally {
    removeRepo(dir);
  }
});

test('a channel apply keeps the guard chain: ack and plan-digest binding', async () => {
  const { dir, config, loaded } = repo();
  try {
    const noAck = await submitCommand({ cwd: dir, options: { channel: 'mcp-official-registry', apply: true }, config, loaded });
    assert.equal(noAck.ok, false);
    assert.match(noAck.error, /--ack/);

    const stale = await submitCommand({
      cwd: dir,
      options: { ...GUARDS, channel: 'mcp-official-registry', plan_digest: 'deadbeef' },
      config,
      loaded,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'plan_digest_mismatch');
    assert.equal(existsSync(join(dir, '.discoverability', 'submissions.json')), false);
  } finally {
    removeRepo(dir);
  }
});
