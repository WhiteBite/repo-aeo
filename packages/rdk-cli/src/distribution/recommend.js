/**
 * Recommends distribution channels for a repository: derives the artifact
 * inventory from the loaded config, evaluates every channel descriptor
 * against it and reads the ledger for the per-channel status.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHANNELS, applicableChannels } from './channels.js';
import { isBlocking, readLedger } from './ledger.js';

export function artifactInventory(loaded) {
  const config = loaded.config;
  // configPath is always <cwd>/.discoverability/project.yml, so its grandparent is the repo root
  const cwd = dirname(dirname(loaded.configPath));
  return {
    has_npm_package: Boolean(config.artifacts.has_npm_package),
    has_docs_site: Boolean(config.artifacts.has_docs_site),
    npm_published: Boolean(config.artifacts.npm_published),
    has_mcp_server: String(config.project.category).toLowerCase() === 'mcp-server',
    has_action: existsSync(join(cwd, '.github', 'workflows')),
    has_skill: hasSkill(cwd),
    git_host: loaded.git.host,
    git_owner: loaded.git.owner,
    git_repo: loaded.git.repo,
  };
}

function hasSkill(cwd) {
  const dir = join(cwd, 'skills');
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')));
}

function nextAction(channel, applicable, status) {
  if (!applicable) return `not applicable: ${channel.when} is false`;
  if (status === 'untried') return `run \`rdk submit --channel ${channel.id}\` to prepare this submission`;
  if (status === 'listed' || status === 'merged') return 'listed - nothing to do';
  if (isBlocking({ status })) return 'a submission is in flight - see .discoverability/submissions.json';
  return `the last submission ended ${status} - one retry is allowed`;
}

export function recommend(cwd, loaded) {
  const inventory = artifactInventory(loaded);
  const records = readLedger(cwd) || [];
  const applicableIds = new Set(applicableChannels(inventory).map((channel) => channel.id));
  const channels = CHANNELS.map((channel) => {
    const mine = records.filter((record) => record && record.channel === channel.id);
    const last = mine.length > 0 ? mine[mine.length - 1] : null;
    const status = last && typeof last.status === 'string' && last.status !== '' ? last.status : 'untried';
    const applicable = applicableIds.has(channel.id);
    return { ...channel, applicable, status, next_action: nextAction(channel, applicable, status) };
  });
  return { inventory, channels };
}
