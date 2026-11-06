/**
 * `rdk share` — the read-only community-post generator: renders the
 * ready-to-post message for a community channel from the project config.
 * Never writes, never touches the network, needs no tokens.
 */
import { loadConfig } from '../config.js';
import { renderShareContent, SHARE_CHANNELS } from '../distribution/artifacts/socialPost.js';

export function shareCommand({ cwd = process.cwd(), options = {}, config, loaded } = {}) {
  const effectiveLoaded = loaded || loadConfig(cwd);
  const effectiveConfig = config || effectiveLoaded.config;
  const lines = ['# rdk share', ''];
  const fail = (error) => ({ ok: false, error, output: `${lines.join('\n')}\n`, exitCode: 1 });

  if (options.list) {
    lines.push('Channels:');
    for (const id of SHARE_CHANNELS) lines.push(`- ${id}`);
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0 };
  }

  const channel = String(options.channel || '');
  if (channel === '') {
    lines.push('A channel is required: pass --channel <id> (run with --list to print every channel).');
    return fail('a channel is required: pass --channel <id> (run with --list to print every channel)');
  }
  const pkg = (effectiveLoaded.publishable && effectiveLoaded.publishable.pkg) || effectiveLoaded.pkg || null;
  const content = renderShareContent(effectiveConfig, pkg, channel);
  if (!content) {
    lines.push(`Unknown channel "${channel}" - run \`rdk share --list\` to print every channel.`);
    return fail(`unknown channel "${channel}"; run \`rdk share --list\``);
  }
  if (options.json) {
    return { ok: true, output: `${JSON.stringify({ title: content.title, body: content.body, postUrl: content.postUrl })}\n`, exitCode: 0 };
  }
  lines.push(`Title: ${content.title}`);
  if (content.body !== '') {
    lines.push('');
    lines.push(content.body);
  }
  lines.push('');
  lines.push(content.postUrl ? `→ Post at: ${content.postUrl}` : '→ Post manually: this channel has no paste URL');
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0 };
}

export default { shareCommand };
