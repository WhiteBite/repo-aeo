/** `rdk init` — scaffold .discoverability/project.yml and the minimal safe files. */
import { join } from 'node:path';
import { buildSeedConfig, loadConfig } from '../config.js';
import { planPatches, applyPatches } from '../fix/patches.js';
import { exists } from '../util/fs.js';
import { unifiedDiff } from '../util/diff.js';

const INIT_PATCHES = [
  'project.create',
  'readme.generate',
  'readme.sections_stub',
  'readme.quickstart_stub',
  'agents.stub',
  'llms.generate',
  'citation.stub',
  'license.stub',
  'security.stub',
  'contributing.stub',
  'readme.examples_stub',
  'gitignore.entries',
  'gitattributes.stub',
  'github.templates',
  'jsonld.snippet',
];

export function initCommand({ cwd, options = {} }) {
  const seed = buildSeedConfig(cwd);
  const ctx = {
    cwd,
    options,
    config: seed,
    configExists: exists(join(cwd, '.discoverability', 'project.yml')),
    pkg: loadConfig(cwd).pkg,
    git: loadConfig(cwd).git,
  };

  const planned = planPatches(ctx, { only: INIT_PATCHES });
  const lines = [];
  lines.push('# rdk init');
  lines.push('');

  if (planned.length === 0) {
    lines.push('Nothing to scaffold — the repository already has the discoverability primitives.');
    lines.push('Run `rdk audit` to see what still needs work.');
    return { ok: true, output: `${lines.join('\n')}\n`, written: [] };
  }

  if (options.apply) {
    const written = applyPatches(planned);
    lines.push(`Applied ${planned.length} patch group(s), wrote ${written.length} file(s):`);
    for (const path of written) lines.push(`  + ${path.replace(`${cwd}/`, '')}`);
    return { ok: true, output: `${lines.join('\n')}\n`, written };
  }

  lines.push(`Planned ${planned.length} patch group(s) (dry run — pass --apply to write):`);
  for (const patch of planned) {
    lines.push('');
    lines.push(`## ${patch.id} — ${patch.title}`);
    lines.push(patch.description);
    for (const change of patch.compute()) {
      lines.push('');
      lines.push(unifiedDiff(change.before, change.after, { path: change.path.replace(`${cwd}/`, '') }));
    }
  }

  lines.push('');
  lines.push('Next steps:');
  lines.push('  1. Review .discoverability/project.yml — it is the source of truth for every generated file.');
  lines.push('  2. Fill in project.one_liner, audiences, use_cases, keywords and differentiators.');
  lines.push('  3. Run `rdk audit` for the score, then `rdk fix --dry-run` for the safe autofixes.');
  return { ok: true, output: `${lines.join('\n')}\n`, written: options.apply ? applyPatches(planned) : [] };
}

export default { initCommand };
