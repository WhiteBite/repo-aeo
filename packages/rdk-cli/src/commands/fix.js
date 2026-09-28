/** `rdk fix` — apply only the safe, idempotent autofix patches. */
import { relative } from 'node:path';
import { loadConfig } from '../config.js';
import { planPatches, applyPatches } from '../fix/patches.js';
import { unifiedDiff } from '../util/diff.js';

export function fixCommand({ cwd, options = {} }) {
  const loaded = loadConfig(cwd);
  const ctx = {
    cwd,
    options,
    config: loaded.config,
    configExists: loaded.exists,
    pkg: loaded.pkg,
    git: loaded.git,
  };

  const only = options.only ? String(options.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const skip = options.skip ? String(options.skip).split(',').map((s) => s.trim()).filter(Boolean) : [];

  const planned = planPatches(ctx, { only, skip });
  const lines = [];
  lines.push('# rdk fix');
  lines.push('');

  if (planned.length === 0) {
    lines.push('No safe autofixes to apply — run `rdk audit` to see the manual work.');
    return { ok: true, output: `${lines.join('\n')}\n`, written: [], planned };
  }

  const totalChanges = planned.reduce(
    (sum, patch) => sum + patch.compute().reduce((inner, change) => inner + (change.before === change.after ? 0 : 1), 0),
    0,
  );

  if (!options.apply) {
    lines.push(`Dry run: ${planned.length} patch group(s), ${totalChanges} file change(s). Pass --apply to write.`);
    for (const patch of planned) {
      lines.push('');
      lines.push(`## ${patch.id} — ${patch.title} [${patch.risk}]`);
      lines.push(patch.description);
      for (const change of patch.compute()) {
        if (change.before === change.after) continue;
        lines.push('');
        lines.push(unifiedDiff(change.before, change.after, { path: relative(cwd, change.path) }));
      }
    }
    return { ok: true, output: `${lines.join('\n')}\n`, written: [], planned };
  }

  const written = applyPatches(planned);
  lines.push(`Applied ${planned.length} patch group(s):`);
  for (const patch of planned) lines.push(`  - ${patch.id}: ${patch.title}`);
  lines.push('');
  lines.push(`Wrote ${written.length} file(s):`);
  for (const path of written) lines.push(`  + ${relative(cwd, path)}`);
  lines.push('');
  lines.push('Reminder: AGENTS.md and README stubs are drafts — review them by hand before committing.');
  lines.push('Never publish, tag or force-push from an autofix branch without an explicit ACK.');
  return { ok: true, output: `${lines.join('\n')}\n`, written, planned };
}

export default { fixCommand };
