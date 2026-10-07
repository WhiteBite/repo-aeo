/**
 * `rdk submit` — propose the project to curated lists (awesome lists and the
 * like). Previews the whole campaign by default; opening pull requests needs
 * the same guard chain as github-sync: --apply --ack --reason --plan-digest.
 */
import { run } from '../util/proc.js';
import { resolveRepo } from './githubSync.js';
import { ACK_HINT, assertWriteGuards, planDigest } from '../distribution/guard.js';
import { isBlocking, readLedger, submissionsPath, upsertRecords } from '../distribution/ledger.js';
import { applicableChannels, channelById } from '../distribution/channels.js';
import { mechanismById } from '../distribution/mechanisms/registry.js';
import { artifactInventory } from '../distribution/recommend.js';
import { buildEntry, insertEntryIntoReadme } from '../distribution/mechanisms/gitPr.js';
import { renderServerJson } from '../distribution/artifacts/serverJson.js';

export { submissionsPath } from '../distribution/ledger.js';
export { buildEntry, insertEntryIntoReadme } from '../distribution/mechanisms/gitPr.js';
export const readSubmissions = readLedger;

const TARGET_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const GUARD_LINES = {
  ack_mismatch: `Refusing to write: --ack must equal ${ACK_HINT}.`,
  reason_required: 'Refusing to write: pass --reason "<why this change is correct>" so the change is auditable.',
  plan_digest_required: 'Refusing to write: --plan-digest is required so the write binds to the approved preview.',
  plan_digest_mismatch: 'Refusing to write: the plan changed since the approved preview (plan_digest mismatch).',
};

function parseTargets(option) {
  const raw = Array.isArray(option) ? option.map(String) : typeof option === 'string' && option !== '' ? option.split(',') : [];
  return raw.map((target) => String(target).trim()).filter(Boolean);
}

function previewValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function planIdentity(item) {
  return typeof item.target === 'string' && item.target !== '' ? item.target : item.channel;
}

function planFor({ cwd, options, config, loaded, channel, mechanism }) {
  const pkg = (loaded && loaded.publishable && loaded.publishable.pkg) || (loaded && loaded.pkg) || null;
  if (channel.mechanism === 'http-json') {
    return mechanism.plan({ targets: options.targets ? parseTargets(options.targets) : [channel.id], channel, payload: renderServerJson(config, pkg) });
  }
  if (channel.mechanism === 'web-form') {
    const repoSlug = resolveRepo(cwd, options);
    return mechanism.plan({ channels: [channel], config, url: repoSlug ? `https://github.com/${repoSlug}` : null });
  }
  if (channel.mechanism === 'cli-publish') return mechanism.plan({ channel, config, pkg });
  return mechanism.plan({ channel });
}

function executeFor({ mechanism, channel, item, cwd, config, fetchImpl, url }) {
  if (channel.mechanism === 'http-json') return mechanism.execute({ item, channel, fetchImpl, env: process.env });
  if (channel.mechanism === 'web-form' || channel.mechanism === 'cli-publish') return mechanism.execute({ item, channel, cwd, config });
  return mechanism.execute({ item, channel, url });
}

async function submitViaChannel({ cwd, options, config, loaded, channel, mechanism, fetchImpl, lines, fail, refuse }) {
  if (loaded && !applicableChannels(artifactInventory(loaded)).some((entry) => entry.id === channel.id)) {
    lines.push(`note: ${channel.id} is not applicable to this repository (${channel.when} is false); continuing anyway`);
  }
  const ledger = readLedger(cwd);
  if (ledger === null) {
    lines.push('Could not parse .discoverability/submissions.json - fix it by hand or restore it from git.');
    return fail('could not parse .discoverability/submissions.json - fix it by hand or restore it from git');
  }
  const blocked = new Map();
  for (const record of ledger) {
    if (!record || !isBlocking(record)) continue;
    if (typeof record.channel === 'string' && record.channel !== '' && record.channel !== channel.id) continue;
    for (const key of [record.target, record.dedupe_key, record.channel]) {
      if (typeof key === 'string' && key !== '' && !blocked.has(key)) blocked.set(key, record.status);
    }
  }

  const plan = planFor({ cwd, options, config, loaded, channel, mechanism });
  const active = plan.filter((item) => !blocked.has(planIdentity(item)));
  const skipped = new Set();
  for (const item of plan) {
    const id = planIdentity(item);
    if (blocked.has(id) && !skipped.has(id)) {
      skipped.add(id);
      lines.push(`- ${id}: skipped, a ${blocked.get(id)} submission is already recorded`);
    }
  }
  lines.push('');

  if (active.length === 0) {
    lines.push('Every target already has a recorded submission - nothing to do.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: [], plan_digest: null, applied: [] };
  }

  const digest = planDigest(active);
  const bound = assertWriteGuards({ options, config, plan: active });
  if (!bound.ok) return refuse(bound, bound.code === 'plan_digest_mismatch' ? { plan_digest: digest } : {});

  for (const item of active) {
    lines.push(`- **${planIdentity(item)}**`);
    for (const [key, value] of Object.entries(item)) {
      if (key === 'target' || key === 'channel') continue;
      lines.push(`  - ${key}: ${previewValue(value)}`);
    }
  }
  lines.push('');

  if (!options.apply) {
    lines.push(`Plan digest: ${digest}`);
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>" --plan-digest <PLAN_DIGEST>` to run this channel.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: active, plan_digest: digest, applied: [] };
  }

  const applied = [];
  const repoSlug = resolveRepo(cwd, options);
  const url = repoSlug ? `https://github.com/${repoSlug}` : null;
  for (const item of active) {
    const executed = await executeFor({ mechanism, channel, item, cwd, config, fetchImpl, url });
    lines.push(...executed.lines);
    if (!executed.ok) return fail(executed.error, { applied });
    if (executed.record) {
      const target = executed.record.target || planIdentity(item);
      applied.push({
        ...executed.record,
        target,
        channel: channel.id,
        mechanism: channel.mechanism,
        artifact: channel.artifact,
        dedupe_key: `${channel.id}:${target}`,
      });
    }
  }

  if (applied.length > 0) upsertRecords(cwd, applied);
  lines.push('');
  lines.push(`Reason logged: ${options.reason}`);
  lines.push(`Recorded ${applied.length} submission(s) in .discoverability/submissions.json.`);
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: active, plan_digest: digest, applied };
}

export async function submitCommand({ cwd, options = {}, config, loaded, ghRunner, gitRunner, fetchImpl }) {
  const gh = ghRunner || ((args, opts = {}) => run('gh', args, { cwd: (opts && opts.cwd) || cwd, timeout: (opts && opts.timeout) || 20000 }));
  const git = gitRunner || ((args, opts = {}) => run('git', args, { cwd: (opts && opts.cwd) || cwd, timeout: (opts && opts.timeout) || 60000 }));
  const lines = ['# rdk submit', ''];
  const fail = (error, extra = {}) => ({ ok: false, error, output: `${lines.join('\n')}\n`, exitCode: 1, applied: [], ...extra });
  const refuse = (guard, extra = {}) => {
    lines.push(GUARD_LINES[guard.code]);
    const coded = guard.code === 'plan_digest_required' || guard.code === 'plan_digest_mismatch' ? { code: guard.code } : {};
    return fail(guard.error, { ...coded, ...extra });
  };

  const early = assertWriteGuards({ options, config });
  if (!early.ok) return refuse(early);

  const channel = channelById(options.channel || 'awesome-list');
  if (!channel) {
    lines.push(`Unknown channel "${String(options.channel)}" - run \`rdk channels\` to list every channel id.`);
    return fail(`unknown channel "${String(options.channel)}"; run \`rdk channels\``);
  }
  const mechanism = mechanismById(channel.mechanism);

  if (channel.mechanism === 'http-json' && channel.id === 'mcp-official-registry') {
    const pkg = (loaded && loaded.publishable && loaded.publishable.pkg) || (loaded && loaded.pkg) || null;
    const mcpName = pkg && typeof pkg.mcpName === 'string' ? pkg.mcpName.trim() : '';
    if (!mcpName) {
      const repoSlug = resolveRepo(cwd, options);
      const projectName = (config && config.project && config.project.name) || (pkg && pkg.name) || 'project';
      const example = `io.github.${repoSlug || projectName}`;
      lines.push(`The official MCP registry requires "mcpName" in package.json; add "mcpName": "${example}" before submitting.`);
      return fail(`package.json is missing "mcpName" - the official MCP registry rejects the submission without it; add "mcpName": "${example}"`);
    }
  }

  if (options.search) {
    if (!gh(['--version']).ok) {
      lines.push('The GitHub CLI (gh) is required for --search. Install it from https://cli.github.com and run `gh auth login`.');
      return fail('the GitHub CLI (gh) is not installed - install it from https://cli.github.com and run `gh auth login`');
    }
    const keyword = (config.keywords && config.keywords.github_topics && config.keywords.github_topics[0]) || config.project.name;
    const query = `awesome ${keyword}`;
    const result = gh(['search', 'repos', query, '--limit', '10', '--json', 'fullName,stargazersCount,description']);
    if (!result.ok) return fail(`gh search failed: ${result.stderr.trim().slice(0, 200)}`);
    let repos;
    try {
      repos = JSON.parse(result.stdout);
    } catch {
      return fail('could not parse the gh search output');
    }
    lines.push(`Candidates for "${query}":`);
    lines.push('');
    for (const repo of repos) {
      lines.push(`- ${repo.fullName} (${repo.stargazersCount ?? '?'} stars) — ${repo.description || ''}`);
    }
    lines.push('');
    lines.push('Pick from these with --targets owner/name[,owner/name...] after reading each list\'s CONTRIBUTING.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied: [] };
  }

  if (channel.mechanism !== 'git-pr') {
    return submitViaChannel({ cwd, options, config, loaded, channel, mechanism, fetchImpl, lines, fail, refuse });
  }

  const targets = parseTargets(options.targets);
  if (targets.length === 0) {
    lines.push('No targets: pass --targets owner/name[,owner/name...] (run with --search to list candidates).');
    return fail('no targets given: pass --targets owner/name[,owner/name...] (run with --search to list candidates)');
  }
  const invalid = targets.filter((target) => !TARGET_RE.test(target));
  if (invalid.length > 0) {
    lines.push(`Invalid target(s) "${invalid.join(', ')}" — expected owner/name.`);
    return fail(`invalid target(s): ${invalid.join(', ')} (expected owner/name)`);
  }
  const category = String(options.category || '').trim();
  if (!category) {
    lines.push('A category is required: pass --category "exact heading text from the list README".');
    return fail('a category is required: pass --category "exact heading text from the list README"');
  }
  const position = options.position === 'alphabetical' ? 'alphabetical' : 'end';

  const repoSlug = resolveRepo(cwd, options);
  const url = repoSlug ? `https://github.com/${repoSlug}` : null;
  if (!url) {
    lines.push('Cannot resolve a GitHub repository URL (no --repo and no github.com origin remote).');
    return fail('cannot resolve a GitHub repository URL (no --repo and no github.com origin remote)');
  }

  const ledger = readLedger(cwd);
  if (ledger === null) {
    lines.push('Could not parse .discoverability/submissions.json - fix it by hand or restore it from git.');
    return fail('could not parse .discoverability/submissions.json - fix it by hand or restore it from git');
  }
  const blocked = new Map(
    ledger
      .filter((item) => item && typeof item.target === 'string' && isBlocking(item))
      .map((item) => [item.target, item.status]),
  );
  const active = targets.filter((target) => !blocked.has(target));
  for (const target of targets) {
    if (blocked.has(target)) lines.push(`- ${target}: skipped, a ${blocked.get(target)} submission is already recorded`);
  }
  lines.push('');

  if (active.length === 0) {
    lines.push('Every target already has a recorded submission - nothing to do.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan: [], plan_digest: null, applied: [] };
  }

  const name = config.project.name || 'project';
  const entry = buildEntry({ name, url, oneLiner: config.project.one_liner || config.project.description, entry: options.entry });
  const plan = mechanism.plan({ targets: active, category, position, entry, name, url });
  const digest = planDigest(plan);

  const bound = assertWriteGuards({ options, config, plan });
  if (!bound.ok) return refuse(bound, bound.code === 'plan_digest_mismatch' ? { plan_digest: digest } : {});

  lines.push(`Project: ${name} (${url})`);
  lines.push('');
  for (const item of plan) {
    lines.push(`- **${item.target}**`);
    lines.push(`  - entry:    ${item.entry}`);
    lines.push(`  - section:  ${item.category} (${position})`);
    lines.push(`  - branch:   ${item.branch}`);
    lines.push(`  - PR title: ${item.title}`);
  }
  lines.push('');

  if (!options.apply) {
    lines.push(`Plan digest: ${digest}`);
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>" --plan-digest <PLAN_DIGEST>` to open the pull requests.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan, plan_digest: digest, applied: [] };
  }

  if (!gh(['--version']).ok) {
    lines.push('The GitHub CLI (gh) is required to open pull requests. Install it from https://cli.github.com and run `gh auth login`.');
    return fail('the GitHub CLI (gh) is not installed - install it from https://cli.github.com and run `gh auth login`');
  }
  const login = gh(['api', 'user', '-q', '.login']);
  if (!login.ok || login.stdout.trim() === '') {
    lines.push('Could not resolve the GitHub login - run `gh auth status`.');
    return fail('could not resolve the GitHub login - run `gh auth status`');
  }
  const owner = login.stdout.trim();
  lines.push(`Fork owner: ${owner}`);

  const applied = [];
  for (const item of plan) {
    const executed = mechanism.execute({ item, owner, gh, git });
    lines.push(...executed.lines);
    if (!executed.ok) return fail(executed.error, { applied });
    applied.push({
      ...executed.record,
      channel: channel.id,
      mechanism: channel.mechanism,
      artifact: channel.artifact,
      dedupe_key: `${channel.id}:${executed.record.target}`,
    });
  }

  const persisted = applied.map((record) => {
    const copy = { ...record };
    delete copy.updated;
    return copy;
  });
  upsertRecords(cwd, persisted);
  lines.push('');
  lines.push(`Reason logged: ${options.reason}`);
  lines.push(`Recorded ${applied.length} submission(s) in .discoverability/submissions.json.`);
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, plan, plan_digest: digest, applied };
}

export default { submitCommand, insertEntryIntoReadme, buildEntry, readSubmissions, submissionsPath };
