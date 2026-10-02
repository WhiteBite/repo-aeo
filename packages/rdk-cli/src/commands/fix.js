/** `rdk fix` — apply only the safe, idempotent autofix patches. */
import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { loadConfig, resolvePackage } from '../config.js';
import { planPatches, applyPatches } from '../fix/patches.js';
import { exists, isDirectory, writeText } from '../util/fs.js';
import { unifiedDiff } from '../util/diff.js';

const MAX_PASSES = 3;

function hasChange(patch) {
  return patch.compute().some((change) => change.before !== change.after);
}

/** One planned pass as plain data: patch metadata plus precomputed mutations. */
function snapshotPass(planned, root) {
  return planned.map((patch) => ({
    id: patch.id,
    title: patch.title,
    description: patch.description,
    risk: patch.risk,
    changes: patch.compute().map((change) => ({
      path: relative(root, change.path),
      before: change.before,
      after: change.after,
    })),
  }));
}

function copyTree(cwd, dest) {
  const excluded = (src) => {
    const rel = relative(cwd, src);
    if (rel === '') return false;
    return rel.split(sep).some((segment) => segment === 'node_modules' || segment === '.git');
  };
  cpSync(cwd, dest, { recursive: true, filter: (src) => !excluded(src) });
  const gitPath = join(cwd, '.git');
  if (!exists(gitPath)) return;
  if (isDirectory(gitPath)) {
    // a .git pointer file (not a junction) keeps git reads working in the copy and is safe to rm -Sync
    writeText(join(dest, '.git'), `gitdir: ${gitPath}\n`);
  } else {
    copyFileSync(gitPath, join(dest, '.git'));
  }
}

/**
 * Plans every pass against a throwaway copy of the repository: later passes
 * see the files earlier passes create, yet the real tree is never written.
 * Falls back to the first pass planned against the real tree when the copy
 * cannot be made.
 */
function simulatePasses({ cwd, ctx, only, skip }) {
  let preview = null;
  try {
    preview = mkdtempSync(join(tmpdir(), 'rdk-fix-preview-'));
    copyTree(cwd, preview);
    const loaded = loadConfig(cwd);
    const publishable = resolvePackage(preview);
    const previewCtx = {
      cwd: preview,
      options: ctx.options,
      config: loaded.config,
      configExists: loaded.exists,
      pkg: publishable.pkg,
      publishable,
      git: loaded.git,
    };
    const passes = [];
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const planned = planPatches(previewCtx, { only, skip }).filter(hasChange);
      if (planned.length === 0) break;
      const snapshot = [];
      for (const patch of planned) {
        // sequential compute+write so same-file patches compose exactly like applyPatches
        const changes = patch.compute().map((change) => ({
          path: relative(preview, change.path),
          before: change.before,
          after: change.after,
        }));
        snapshot.push({ id: patch.id, title: patch.title, description: patch.description, risk: patch.risk, changes });
        for (const change of changes) writeText(join(preview, change.path), change.after);
      }
      passes.push(snapshot);
    }
    return passes;
  } catch {
    const planned = planPatches(ctx, { only, skip }).filter(hasChange);
    return planned.length > 0 ? [snapshotPass(planned, ctx.cwd)] : [];
  } finally {
    if (preview) rmSync(preview, { recursive: true, force: true });
  }
}

export function fixCommand({ cwd, options = {} }) {
  const loaded = loadConfig(cwd);
  const ctx = {
    cwd,
    options,
    config: loaded.config,
    configExists: loaded.exists,
    pkg: loaded.publishable.pkg,
    publishable: loaded.publishable,
    git: loaded.git,
  };

  const only = options.only ? String(options.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const skip = options.skip ? String(options.skip).split(',').map((s) => s.trim()).filter(Boolean) : [];

  const lines = [];
  lines.push('# rdk fix');
  lines.push('');

  if (!options.apply) {
    const passes = simulatePasses({ cwd, ctx, only, skip });
    const planned = passes.flat();
    if (planned.length === 0) {
      lines.push('No safe autofixes to apply — run `rdk audit` to see the manual work.');
      return { ok: true, output: `${lines.join('\n')}\n`, written: [], planned: [] };
    }
    const totalChanges = planned.reduce((sum, patch) => sum + patch.changes.filter((change) => change.before !== change.after).length, 0);
    lines.push(`Dry run: ${planned.length} patch group(s), ${totalChanges} file change(s)${passes.length > 1 ? ` across ${passes.length} passes` : ''}. Pass --apply to write.`);
    passes.forEach((pass, index) => {
      if (passes.length > 1) {
        lines.push('');
        lines.push(`## Pass ${index + 1}`);
      }
      for (const patch of pass) {
        lines.push('');
        lines.push(`## ${patch.id} — ${patch.title} [${patch.risk}]`);
        lines.push(patch.description);
        for (const change of patch.changes) {
          if (change.before === change.after) continue;
          lines.push('');
          lines.push(unifiedDiff(change.before, change.after, { path: change.path }));
        }
      }
    });
    return { ok: true, output: `${lines.join('\n')}\n`, written: [], planned };
  }

  const passes = [];
  const written = [];
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const planned = planPatches(ctx, { only, skip }).filter(hasChange);
    if (planned.length === 0) break;
    passes.push(planned);
    written.push(...applyPatches(planned));
  }

  if (passes.length === 0) {
    lines.push('No safe autofixes to apply — run `rdk audit` to see the manual work.');
    return { ok: true, output: `${lines.join('\n')}\n`, written: [], planned: [] };
  }

  const applied = passes.flat();
  lines.push(`Applied ${applied.length} patch group(s)${passes.length > 1 ? ` in ${passes.length} passes` : ''}:`);
  for (const patch of applied) lines.push(`  - ${patch.id}: ${patch.title}`);
  lines.push('');
  lines.push(`Wrote ${written.length} file(s):`);
  for (const path of written) lines.push(`  + ${relative(cwd, path)}`);
  lines.push('');
  lines.push('Reminder: AGENTS.md and README stubs are drafts — review them by hand before committing.');
  lines.push('Never publish, tag or force-push from an autofix branch without an explicit ACK.');
  return { ok: true, output: `${lines.join('\n')}\n`, written, planned: applied };
}

export default { fixCommand };
