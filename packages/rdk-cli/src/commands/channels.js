/**
 * `rdk channels` — the read-only view of the distribution channel registry:
 * every channel with its mechanism, applicability, recorded status and next
 * action. Never writes and needs neither gh nor git.
 */
import { recommend } from '../distribution/recommend.js';

export function channelsCommand({ cwd, loaded }) {
  const { channels } = recommend(cwd, loaded);
  const lines = ['# rdk channels', ''];
  for (const channel of channels) {
    lines.push(`- ${channel.id} (${channel.mechanism})`);
    lines.push(`  applicable:  ${channel.applicable ? 'yes' : 'no'}`);
    lines.push(`  status:      ${channel.status}`);
    lines.push(`  next action: ${channel.next_action}`);
  }
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0 };
}

export default { channelsCommand };
