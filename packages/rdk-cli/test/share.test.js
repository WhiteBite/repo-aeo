import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderShareContent, SHARE_CHANNELS } from '../src/distribution/artifacts/socialPost.js';
import {
  describe as describeSocialApi,
  plan as planSocialApi,
  execute as executeSocialApi,
  probe as probeSocialApi,
} from '../src/distribution/mechanisms/socialApi.js';
import { shareCommand } from '../src/commands/share.js';
import { submitCommand } from '../src/commands/submit.js';
import { channelById } from '../src/distribution/channels.js';
import { loadConfig } from '../src/config.js';
import { listFiles } from '../src/util/fs.js';
import { makeRepo, removeRepo } from './helpers.js';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', 'bin', 'rdk.js');

const PROJECT_YML = [
  'project:',
  '  name: "demo-project"',
  '  one_liner: "A demo project for share tests."',
  'links:',
  '  homepage: "https://github.com/owner/demo-project#readme"',
  'keywords:',
  '  github_topics:',
  '    - "demo tool"',
  '    - "sharing"',
  '    - "cli"',
  '    - "extra-topic"',
  'differentiators:',
  '  - "First differentiator"',
  '  - "Second differentiator"',
  '  - "Third differentiator"',
].join('\n');

const PKG = { name: 'demo-project', version: '1.2.3' };

const CONFIG = {
  project: { name: 'demo-project', one_liner: 'A demo project for share tests.' },
  links: { homepage: 'https://github.com/owner/demo-project#readme' },
  keywords: { github_topics: ['demo tool', 'sharing', 'cli', 'extra-topic'] },
  differentiators: ['First differentiator', 'Second differentiator', 'Third differentiator'],
};

function repo() {
  const dir = makeRepo({ '.discoverability/project.yml': PROJECT_YML, 'package.json': JSON.stringify(PKG) });
  const loaded = loadConfig(dir);
  return { dir, config: loaded.config, loaded };
}

function rdk(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

function snapshotTree(dir) {
  const out = {};
  for (const path of listFiles(dir, { recursive: true })) {
    out[relative(dir, path)] = readFileSync(path, 'utf8');
  }
  return out;
}

test('renderShareContent returns { title, body, postUrl } for every kind', () => {
  assert.equal(SHARE_CHANNELS.length, 7);
  for (const kind of SHARE_CHANNELS) {
    const content = renderShareContent(CONFIG, PKG, kind);
    assert.ok(content, `${kind} must render`);
    assert.equal(typeof content.title, 'string');
    assert.equal(typeof content.body, 'string');
    assert.equal(typeof content.postUrl, 'string');
    assert.notEqual(content.title, '');
    assert.ok(content.postUrl === '' || content.postUrl.startsWith('https://'), `${kind} postUrl must be a URL or empty`);
  }
  assert.equal(renderShareContent(CONFIG, PKG, 'hn-show').body, '');
  assert.equal(renderShareContent(CONFIG, PKG, 'telegram-dev').postUrl, '');
  assert.equal(renderShareContent(CONFIG, PKG, 'no-such-kind'), null);
});

test('each kind renders distinct content whose title carries the name or the one-liner', () => {
  const seen = new Map();
  for (const kind of SHARE_CHANNELS) {
    const content = renderShareContent(CONFIG, PKG, kind);
    assert.ok(
      content.title.includes('demo-project') || content.title.includes('A demo project for share tests.'),
      `${kind} title must carry the name or the one-liner`,
    );
    const key = JSON.stringify(content);
    assert.ok(!seen.has(key), `the rendering for ${kind} collides with ${seen.get(key)}`);
    seen.set(key, kind);
  }
});

test('renderShareContent is deterministic', () => {
  for (const kind of SHARE_CHANNELS) {
    assert.deepEqual(renderShareContent(CONFIG, PKG, kind), renderShareContent(CONFIG, PKG, kind));
  }
});

test('the reddit format pins the title, the differentiators and the hashtags', () => {
  assert.deepEqual(renderShareContent(CONFIG, PKG, 'reddit-r-webdev'), {
    title: 'A demo project for share tests. [demo-project]',
    body: 'A demo project for share tests.\n\n- First differentiator\n- Second differentiator\n- Third differentiator\n\n#demo-tool #sharing #cli',
    postUrl: 'https://www.reddit.com/r/webdev/submit',
  });
  assert.equal(renderShareContent(CONFIG, PKG, 'reddit-r-node').postUrl, 'https://www.reddit.com/r/node/submit');
  assert.equal(renderShareContent(CONFIG, PKG, 'reddit-r-programming').postUrl, 'https://www.reddit.com/r/programming/submit');
});

test('the telegram format uses bullet differentiators and the homepage with no paste URL', () => {
  assert.deepEqual(renderShareContent(CONFIG, PKG, 'telegram-dev'), {
    title: 'demo-project — A demo project for share tests.',
    body: 'A demo project for share tests.\n\n• First differentiator\n• Second differentiator\n• Third differentiator\n\nhttps://github.com/owner/demo-project#readme',
    postUrl: '',
  });
});

test('the hn-show format is a Show HN title with an empty body', () => {
  assert.deepEqual(renderShareContent(CONFIG, PKG, 'hn-show'), {
    title: 'Show HN: demo-project — A demo project for share tests.',
    body: '',
    postUrl: 'https://news.ycombinator.com/submit',
  });
});

test('the twitter format is a 4-part thread ending on the homepage', () => {
  assert.deepEqual(renderShareContent(CONFIG, PKG, 'twitter-dev'), {
    title: 'A demo project for share tests.',
    body: '1/4 A demo project for share tests.\n\n2/4 First differentiator\nSecond differentiator\n\n3/4 Try it: npx demo-project audit\n\nhttps://github.com/owner/demo-project#readme',
    postUrl: 'https://twitter.com/intent/tweet',
  });
});

test('the devto format is a markdown article with Why and Quickstart sections', () => {
  assert.deepEqual(renderShareContent(CONFIG, PKG, 'devto'), {
    title: 'A demo project for share tests.',
    body: 'A demo project for share tests.\n\n## Why\n\n- First differentiator\n- Second differentiator\n- Third differentiator\n\n## Quickstart\n\n`npx demo-project audit`',
    postUrl: 'https://dev.to/new',
  });
});

test('rdk share --channel reddit-r-webdev prints the title, the body and a paste link', () => {
  const { dir } = repo();
  try {
    const result = rdk(['share', '--channel', 'reddit-r-webdev'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Title: A demo project for share tests\. \[demo-project\]/);
    assert.match(result.stdout, /- First differentiator/);
    assert.match(result.stdout, /#demo-tool #sharing #cli/);
    assert.match(result.stdout, /→ Post at: https:\/\/www\.reddit\.com\/r\/webdev\/submit/);
  } finally {
    removeRepo(dir);
  }
});

test('rdk share --list prints every share channel id', () => {
  const { dir } = repo();
  try {
    const result = rdk(['share', '--list'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const id of SHARE_CHANNELS) {
      assert.match(result.stdout, new RegExp(`^- ${id}$`, 'm'));
    }
  } finally {
    removeRepo(dir);
  }
});

test('rdk share --channel bogus fails with exit 1', () => {
  const { dir } = repo();
  try {
    const result = rdk(['share', '--channel', 'bogus'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /unknown channel/i);
    assert.match(result.stdout, /rdk share --list/);
  } finally {
    removeRepo(dir);
  }
});

test('rdk share without --channel fails with exit 1', () => {
  const { dir } = repo();
  try {
    const result = rdk(['share'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /channel is required/i);
  } finally {
    removeRepo(dir);
  }
});

test('rdk share --channel reddit-r-webdev --json emits pure JSON', () => {
  const { dir } = repo();
  try {
    const result = rdk(['share', '--channel', 'reddit-r-webdev', '--json'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ['body', 'postUrl', 'title']);
    assert.equal(parsed.title, 'A demo project for share tests. [demo-project]');
    assert.equal(parsed.postUrl, 'https://www.reddit.com/r/webdev/submit');
    assert.ok(parsed.body.includes('- First differentiator'));
  } finally {
    removeRepo(dir);
  }
});

test('shareCommand is read-only: no network, no tokens, no writes', () => {
  const { dir, config, loaded } = repo();
  try {
    const before = snapshotTree(dir);
    const result = shareCommand({ cwd: dir, options: { channel: 'telegram-dev' }, config, loaded });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /Title: demo-project — A demo project for share tests\./);
    assert.match(result.output, /• First differentiator/);
    assert.match(result.output, /Post manually/);
    assert.deepEqual(snapshotTree(dir), before, 'rdk share must not write anything');
  } finally {
    removeRepo(dir);
  }
});

test('describe exposes the social-api mechanism contract', () => {
  const d = describeSocialApi();
  assert.equal(d.id, 'social-api');
  assert.equal(typeof d.summary, 'string');
  assert.ok(d.summary.length > 0);
});

test('socialApi.plan returns plan items whose payload comes from the renderer', () => {
  const telegram = channelById('telegram-dev');
  const items = planSocialApi({ targets: ['telegram-dev'], channel: telegram, config: CONFIG, pkg: PKG });
  assert.deepEqual(items, [{
    target: 'telegram-dev',
    endpoint: 'https://api.telegram.org/bot{BOT_TOKEN_ENV}/sendMessage',
    method: 'POST',
    payload: { chat_id: telegram.channelId, text: renderShareContent(CONFIG, PKG, 'telegram-dev').body, parse_mode: 'Markdown' },
  }]);
  assert.deepEqual(planSocialApi({ targets: [], channel: telegram, config: CONFIG, pkg: PKG }), []);

  const devto = channelById('devto');
  const [devtoItem] = planSocialApi({ targets: ['devto'], channel: devto, config: CONFIG, pkg: PKG });
  assert.deepEqual(devtoItem.payload, {
    article: {
      title: renderShareContent(CONFIG, PKG, 'devto').title,
      body_markdown: renderShareContent(CONFIG, PKG, 'devto').body,
      tags: CONFIG.keywords.github_topics,
      published: false,
    },
  });
});

test('socialApi.execute fails with auth_required and never calls fetch without a token', async () => {
  const channel = channelById('telegram-dev');
  const [item] = planSocialApi({ targets: ['telegram-dev'], channel, config: CONFIG, pkg: PKG });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const result = await executeSocialApi({ item, channel, fetchImpl, env: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /auth_required/);
  assert.match(result.error, /TELEGRAM_BOT_TOKEN/);
  assert.equal(calls.length, 0);
});

test('socialApi.execute posts the telegram payload and records submitted without a response URL', async () => {
  const channel = channelById('telegram-dev');
  const [item] = planSocialApi({ targets: ['telegram-dev'], channel, config: CONFIG, pkg: PKG });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{"ok":true,"result":{"message_id":42}}' };
  };
  const result = await executeSocialApi({ item, channel, fetchImpl, env: { TELEGRAM_BOT_TOKEN: 'stub-token' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'submitted');
  assert.equal(result.record.url, null);
  assert.equal(result.record.target, 'telegram-dev');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bot{BOT_TOKEN_ENV}/sendMessage');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer stub-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), item.payload);
  assert.ok(result.lines.some((line) => line.includes('submitted:')));
});

test('socialApi.execute posts the devto payload and records listed when the response carries a URL', async () => {
  const channel = channelById('devto');
  const [item] = planSocialApi({ targets: ['devto'], channel, config: CONFIG, pkg: PKG });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return { ok: true, status: 201, text: async () => JSON.stringify({ url: 'https://dev.to/owner/demo-project' }) };
  };
  const result = await executeSocialApi({ item, channel, fetchImpl, env: { DEVTO_API_KEY: 'stub-key' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'listed');
  assert.equal(result.record.url, 'https://dev.to/owner/demo-project');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://dev.to/api/articles');
  assert.equal(calls[0].init.headers.authorization, 'Bearer stub-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), item.payload);
});

test('socialApi.execute fails on a non-2xx response with the HTTP status in the error', async () => {
  const channel = channelById('devto');
  const [item] = planSocialApi({ targets: ['devto'], channel, config: CONFIG, pkg: PKG });
  const fetchImpl = async () => ({ ok: false, status: 422, text: async () => 'title has already been taken' });
  const result = await executeSocialApi({ item, channel, fetchImpl, env: { DEVTO_API_KEY: 'stub-key' } });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 422/);
  assert.ok(result.error.includes('title has already been taken'));
});

test('socialApi.execute returns a manual checklist when automatable is false', async () => {
  const channel = { ...channelById('telegram-dev'), automatable: false };
  const [item] = planSocialApi({ targets: ['telegram-dev'], channel, config: CONFIG, pkg: PKG });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const result = await executeSocialApi({ item, channel, fetchImpl, env: { TELEGRAM_BOT_TOKEN: 'stub-token' } });
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'prepared');
  assert.ok(Array.isArray(result.checklist.steps));
  assert.equal(calls.length, 0);
});

test('socialApi.probe reports the recorded post URL as a social-api ref', () => {
  assert.deepEqual(probeSocialApi({ url: 'https://dev.to/owner/demo-project' }), { kind: 'social-api', ref: 'https://dev.to/owner/demo-project' });
  assert.deepEqual(probeSocialApi({}), { kind: 'social-api', ref: null });
  assert.deepEqual(probeSocialApi(null), { kind: 'social-api', ref: null });
});

test('the telegram-dev descriptor carries the Bot API endpoint, auth and chat id', () => {
  const telegram = channelById('telegram-dev');
  assert.equal(telegram.mechanism, 'social-api');
  assert.equal(telegram.artifact, 'community-post');
  assert.deepEqual(telegram.accepts, ['repo', 'npm-package']);
  assert.equal(telegram.when, 'has_repo');
  assert.equal(telegram.automatable, true);
  assert.equal(telegram.probe, 'social-api');
  assert.equal(telegram.endpoint, 'https://api.telegram.org/bot{BOT_TOKEN_ENV}/sendMessage');
  assert.equal(telegram.method, 'POST');
  assert.deepEqual(telegram.auth, { env: 'TELEGRAM_BOT_TOKEN' });
  assert.equal(telegram.kind, 'telegram-dev');
  assert.equal(typeof telegram.channelId, 'string');
  assert.notEqual(telegram.channelId, '');
});

test('the devto descriptor carries the articles endpoint and auth', () => {
  const devto = channelById('devto');
  assert.equal(devto.mechanism, 'social-api');
  assert.equal(devto.artifact, 'community-post');
  assert.deepEqual(devto.accepts, ['repo', 'npm-package']);
  assert.equal(devto.when, 'has_repo');
  assert.equal(devto.automatable, true);
  assert.equal(devto.probe, 'social-api');
  assert.equal(devto.endpoint, 'https://dev.to/api/articles');
  assert.equal(devto.method, 'POST');
  assert.deepEqual(devto.auth, { env: 'DEVTO_API_KEY' });
  assert.equal(devto.kind, 'devto');
});

test('rdk submit --channel telegram-dev previews the payload and applies under the write guard', async () => {
  const { dir, config, loaded } = repo();
  try {
    const preview = await submitCommand({ cwd: dir, options: { channel: 'telegram-dev' }, config, loaded });
    assert.equal(preview.ok, true);
    assert.equal(preview.exitCode, 0);
    assert.match(preview.output, /- \*\*telegram-dev\*\*/);
    assert.match(preview.output, /endpoint: https:\/\/api\.telegram\.org\/bot\{BOT_TOKEN_ENV\}\/sendMessage/);
    assert.match(preview.output, /method: POST/);
    assert.match(preview.output, /payload: \{/);
    assert.match(preview.output, /Plan digest: [0-9a-f]{64}/);
    assert.match(preview.output, /Dry run/);
    assert.equal(preview.applied.length, 0);

    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const hadToken = Object.hasOwn(process.env, 'TELEGRAM_BOT_TOKEN');
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'stub-token';
    try {
      const result = await submitCommand({
        cwd: dir,
        options: {
          apply: true,
          ack: 'I_ACK_RDK_GITHUB_WRITE',
          reason: 'unit test social post',
          channel: 'telegram-dev',
          plan_digest: preview.plan_digest,
        },
        config,
        loaded,
        fetchImpl,
      });
      assert.equal(result.ok, true, result.output);
      assert.equal(result.applied.length, 1);
      assert.equal(result.applied[0].mechanism, 'social-api');
      assert.equal(result.applied[0].channel, 'telegram-dev');
      assert.equal(result.applied[0].status, 'submitted');
      assert.equal(result.applied[0].dedupe_key, 'telegram-dev:telegram-dev');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.telegram.org/bot{BOT_TOKEN_ENV}/sendMessage');
      assert.deepEqual(JSON.parse(calls[0].init.body), {
        chat_id: channelById('telegram-dev').channelId,
        text: renderShareContent(config, loaded.pkg, 'telegram-dev').body,
        parse_mode: 'Markdown',
      });
      const ledger = JSON.parse(readFileSync(join(dir, '.discoverability', 'submissions.json'), 'utf8'));
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].mechanism, 'social-api');
      assert.equal(ledger[0].status, 'submitted');
    } finally {
      if (hadToken) process.env.TELEGRAM_BOT_TOKEN = prevToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
    }
  } finally {
    removeRepo(dir);
  }
});

test('rdk submit --channel telegram-dev keeps the guard chain: ack and plan-digest binding', async () => {
  const { dir, config, loaded } = repo();
  try {
    const noAck = await submitCommand({ cwd: dir, options: { channel: 'telegram-dev', apply: true }, config, loaded });
    assert.equal(noAck.ok, false);
    assert.match(noAck.error, /--ack/);

    const stale = await submitCommand({
      cwd: dir,
      options: {
        apply: true,
        ack: 'I_ACK_RDK_GITHUB_WRITE',
        reason: 'unit test social post',
        channel: 'telegram-dev',
        plan_digest: 'deadbeef',
      },
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
