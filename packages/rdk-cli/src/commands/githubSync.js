import { run } from '../util/proc.js';
import { slugifyTopic, uniq } from '../audit/checks/_shared.js';
import { gitInfo } from '../util/git.js';
import { ACK_HINT, effectiveAck, planDigest } from '../distribution/guard.js';

export { DEFAULT_ACK, effectiveAck, planDigest } from '../distribution/guard.js';

function defaultGh(args, { cwd }) {
  return run('gh', args, { cwd, timeout: 20000 });
}

export function resolveRepo(cwd, options) {
  if (options.repo) return options.repo;
  const git = gitInfo(cwd);
  if (git.host === 'github.com' && git.owner && git.repo) return `${git.owner}/${git.repo}`;
  return null;
}

export async function githubSyncCommand({ cwd, options = {}, config, ghRunner }) {
  const gh = ghRunner || defaultGh;
  const lines = [];
  lines.push('# rdk github-sync');
  lines.push('');

  if (options.apply) {
    if (String(options.ack || '') !== effectiveAck(config)) {
      lines.push(`Refusing to write: --ack must equal ${ACK_HINT}.`);
      return { ok: false, error: `refusing to write: --ack must equal ${ACK_HINT}`, output: `${lines.join('\n')}\n`, exitCode: 1, applied: [] };
    }
    if (!options.reason || String(options.reason).trim().length < 5) {
      lines.push('Refusing to write: pass --reason "<why this change is correct>" so the change is auditable.');
      return { ok: false, error: 'refusing to write: a non-trivial reason is required and is logged', output: `${lines.join('\n')}\n`, exitCode: 1, applied: [] };
    }
    if (options.plan_digest === undefined || options.plan_digest === null || String(options.plan_digest).trim() === '') {
      lines.push('Refusing to write: --plan-digest is required so the write binds to the approved preview.');
      return {
        ok: false,
        code: 'plan_digest_required',
        error: 'refusing to write: --plan-digest is required - run the dry-run preview first and pass its Plan digest with --plan-digest',
        output: `${lines.join('\n')}\n`,
        exitCode: 1,
        applied: [],
      };
    }
  }

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

  const fullPlan = [];
  const wantDescription = config.project.one_liner || config.project.description || null;
  if (desiredTopics.length === 0) {
    if (options.topics !== false) {
      lines.push('desired topics empty - refusing to clear remote topics; fill keywords.github_topics in .discoverability/project.yml');
      lines.push('');
    }
  } else if (options.topics !== false && JSON.stringify(desiredTopics) !== JSON.stringify(liveTopics)) {
    fullPlan.push({ field: 'topics', from: liveTopics, to: desiredTopics });
  }
  if (options.description !== false && wantDescription && wantDescription !== (live.description || '')) {
    fullPlan.push({ field: 'description', from: live.description || '', to: wantDescription });
  }
  if (options.homepage !== false && config.links.homepage && config.links.homepage !== (live.homepageUrl || '')) {
    fullPlan.push({ field: 'homepage', from: live.homepageUrl || '', to: config.links.homepage });
  }

  const plan = fields ? fullPlan.filter((change) => fields.includes(change.field)) : fullPlan;
  const digest = planDigest(plan);

  if (options.apply && String(options.plan_digest) !== digest) {
    lines.push('Refusing to write: the plan changed since the approved preview (plan_digest mismatch).');
    return {
      ok: false,
      code: 'plan_digest_mismatch',
      error: 'refusing to write: plan_digest mismatch - the live repository state changed since the approved preview; re-run the preview and approve the new plan',
      plan_digest: digest,
      output: `${lines.join('\n')}\n`,
      exitCode: 1,
      applied: [],
    };
  }

  if (plan.length === 0) {
    lines.push(`✅ ${repo} already matches .discoverability/project.yml (description, homepage, topics).`);
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied: [], plan, plan_digest: digest };
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
    lines.push(`Plan digest: ${digest}`);
    lines.push('Dry run. Re-run with `--apply --ack <ACK_STRING> --reason "<why>" --plan-digest <PLAN_DIGEST>` to write these values.');
    return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied: [], plan, plan_digest: digest };
  }

  const applied = [];
  for (const change of plan) {
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
  return { ok: true, output: `${lines.join('\n')}\n`, exitCode: 0, applied, plan, plan_digest: digest };
}

export default { githubSyncCommand };
