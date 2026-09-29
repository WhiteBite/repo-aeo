/**
 * `rdk github-sync` — push the config's description / homepage / topics to
 * GitHub. Read-only by default: writes need --apply AND an --ack string, and
 * every call is logged with its reason.
 */
import { run } from '../util/proc.js';
import { slugifyTopic, uniq } from '../audit/checks/_shared.js';
import { gitInfo } from '../util/git.js';

export const DEFAULT_ACK = 'I_ACK_RDK_GITHUB_WRITE';

function gh(args, { cwd }) {
  return run('gh', args, { cwd, timeout: 20000 });
}

export function resolveRepo(cwd, options) {
  if (options.repo) return options.repo;
  const git = gitInfo(cwd);
  if (git.host === 'github.com' && git.owner && git.repo) return `${git.owner}/${git.repo}`;
  return null;
}

export async function githubSyncCommand({ cwd, options = {}, config }) {
  const lines = [];
  lines.push('# rdk github-sync');
  lines.push('');

  const repo = resolveRepo(cwd, options);
  if (!repo) {
    return { ok: false, error: 'cannot resolve a GitHub repository (no --repo and no github.com origin remote)', output: `${lines.join('\n')}\nCannot resolve a GitHub repository (no --repo and no github.com origin remote).\n`, exitCode: 1 };
  }

  const ghAvailable = gh(['--version'], { cwd }).ok;
  if (!ghAvailable) {
    return { ok: false, error: 'the GitHub CLI (gh) is not installed - install it from https://cli.github.com and run `gh auth login`', output: `${lines.join('\n')}\nThe GitHub CLI (gh) is required for github-sync. Install it from https://cli.github.com and run \`gh auth login\`.\n`, exitCode: 1 };
  }

  const view = gh(['repo', 'view', repo, '--json', 'description,homepageUrl,repositoryTopics'], { cwd });
  if (!view.ok) {
    return { ok: false, error: `could not read ${repo}: ${view.stderr.trim().slice(0, 200)}`, output: `${lines.join('\n')}\nCould not read ${repo}: ${view.stderr.trim().slice(0, 200)}\n`, exitCode: 1 };
  }

  let live;
  try {
    live = JSON.parse(view.stdout);
  } catch {
    return { ok: false, error: `could not parse gh output for ${repo}`, output: `${lines.join('\n')}\nCould not parse gh output for ${repo}.\n`, exitCode: 1 };
  }

  const desiredTopics = uniq(((config.keywords && config.keywords.github_topics) || []).map(slugifyTopic).filter(Boolean));
  const liveTopics = uniq((live.repositoryTopics || []).map((t) => (t && t.name) || String(t)));
  const fields = Array.isArray(options.fields) && options.fields.length > 0 ? options.fields : null;

  const plan = [];
  const wantDescription = config.project.one_liner || config.project.description || null;
  if (options.topics !== false && JSON.stringify(desiredTopics) !== JSON.stringify(liveTopics)) {
    plan.push({ field: 'topics', from: liveTopics, to: desiredTopics });
  }
  if (options.description !== false && wantDescription && wantDescription !== (live.description || '')) {
    plan.push({ field: 'description', from: live.description || '', to: wantDescription });
  }
  if (options.homepage !== false && config.links.homepage && config.links.homepage !== (live.homepageUrl || '')) {
    plan.push({ field: 'homepage', from: live.homepageUrl || '', to: config.links.homepage });
  }

  if (plan.length === 0) {
    lines.push(`✅ ${repo} already matches .discoverability/project.yml (description, homepage, topics).`);
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied: [] };
  }

  lines.push(`Repository: ${repo}`);
  lines.push('');
  for (const change of plan) {
    lines.push(`- **${change.field}**`);
    lines.push(`  - current: ${change.field === 'topics' ? (change.from.join(', ') || '(none)') : (change.from || '(empty)')}`);
    lines.push(`  - target:  ${change.field === 'topics' ? change.to.join(', ') : change.to}`);
  }
  lines.push('');

  if (!options.apply) {
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>"` to write these values.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied: [], plan };
  }

  if (String(options.ack || '') !== DEFAULT_ACK) {
    lines.push(`Refusing to write: pass --ack ${DEFAULT_ACK} to confirm an explicit repository write.`);
    return { ok: false, error: `refusing to write: pass --ack ${DEFAULT_ACK} to confirm an explicit repository write`, output: `${lines.join('\n')}\n`, exitCode: 1, applied: [] };
  }
  if (!options.reason || String(options.reason).trim().length < 5) {
    lines.push('Refusing to write: pass --reason "<why this change is correct>" so the change is auditable.');
    return { ok: false, error: 'refusing to write: a non-trivial reason is required and is logged', output: `${lines.join('\n')}\n`, exitCode: 1, applied: [] };
  }

  const applied = [];
  const planned = fields ? plan.filter((change) => fields.includes(change.field)) : plan;
  for (const change of planned) {
    let result;
    if (change.field === 'topics') {
      const args = ['api', '--method', 'PUT', `repos/${repo}/topics`];
      for (const topic of change.to) args.push('-f', `names[]=${topic}`);
      result = gh(args, { cwd });
    } else {
      result = gh(['api', '--method', 'PATCH', `repos/${repo}`, '-f', `${change.field}=${change.to}`], { cwd });
    }
    if (!result.ok) {
      lines.push(`❌ failed to update ${change.field}: ${result.stderr.trim().slice(0, 200)}`);
      return { ok: false, error: `failed to update ${change.field}: ${result.stderr.trim().slice(0, 200)}`, output: `${lines.join('\n')}\n`, exitCode: 1, applied };
    }
    applied.push(change.field);
    lines.push(`✅ updated ${change.field}`);
  }
  lines.push('');
  lines.push(`Reason logged: ${options.reason}`);
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied, plan };
}

export default { githubSyncCommand };
