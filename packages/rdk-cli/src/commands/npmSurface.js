/**
 * `rdk npm-surface` — a focused report on the publishable surface of
 * package.json: exports resolution, types, sideEffects, engines, bin, files
 * and (optionally) the real tarball contents via `npm pack --dry-run`.
 */
import { join, dirname } from 'node:path';
import { readJsonIfExists, exists } from '../util/fs.js';
import { resolvePackage } from '../config.js';
import { run, npmBinary } from '../util/proc.js';

function exportsSummary(pkg) {
  if (!pkg.exports) return { present: false, conditions: [], subpaths: [], main: pkg.main || null };
  const conditions = new Set();
  const subpaths = [];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      conditions.add('default');
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('.')) {
          subpaths.push(key);
          walk(value, `${path}${key}`);
          continue;
        }
        if (key === 'default') {
          conditions.add('default');
          continue;
        }
        if (typeof value === 'string') conditions.add(key);
        else walk(value, `${path}${key}/`);
      }
    }
  };
  walk(pkg.exports, '');
  return { present: true, conditions: [...conditions], subpaths, main: pkg.main || null };
}

function packDryRun(cwd, packageDir) {
  // Node forbids spawning .cmd without a shell (CVE-2024-27980); quote the path arg for cmd.exe.
  const winShell = process.platform === 'win32';
  const args = ['pack', '--dry-run', '--json'];
  if (packageDir && packageDir !== cwd) args.push(winShell ? `"${packageDir}"` : packageDir);
  const npm = run(npmBinary(), args, { cwd, timeout: 60000, shell: winShell });
  if (!npm.ok) return { ok: false, error: npm.stderr.trim().slice(0, 200) || 'npm pack failed' };
  try {
    const json = JSON.parse(npm.stdout);
    const entry = Array.isArray(json) ? json[0] : json;
    const files = (entry.files || []).map((file) => file.path);
    return {
      ok: true,
      name: entry.name,
      version: entry.version,
      fileCount: files.length,
      unpackedSize: entry.unpackedSize,
      files,
    };
  } catch {
    return { ok: false, error: 'could not parse npm pack output' };
  }
}

export function npmSurfaceCommand({ cwd, options = {} }) {
  const format = options.format === undefined || options.format === null ? 'markdown' : options.format;
  if (typeof format !== 'string' || !['json', 'markdown'].includes(format)) {
    return {
      ok: false,
      output: '',
      exitCode: 1,
      report: null,
      summary: `rdk: --format must be one of json|markdown, got ${JSON.stringify(String(options.format))}`,
    };
  }

  const resolved = resolvePackage(cwd);
  const pkg = resolved.pkg;
  const lines = [];
  lines.push('# rdk npm-surface');
  lines.push('');

  if (!pkg) {
    lines.push('No package.json found — nothing to audit.');
    return { ok: false, output: `${lines.join('\n')}\n`, exitCode: 1, report: null };
  }

  const ex = exportsSummary(pkg);
  const scripts = pkg.scripts || {};
  const files = Array.isArray(pkg.files) ? pkg.files : null;
  const report = {
    name: pkg.name,
    version: pkg.version,
    private: Boolean(pkg.private),
    description: pkg.description || null,
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords.length : 0,
    repository: pkg.repository || null,
    homepage: pkg.homepage || null,
    bugs: pkg.bugs || null,
    exports: ex,
    types: pkg.types || pkg.typings || null,
    typesVersions: pkg.typesVersions || null,
    sideEffects: pkg.sideEffects === undefined ? null : pkg.sideEffects,
    engines: pkg.engines || null,
    bin: pkg.bin || null,
    files,
    scripts: Object.keys(scripts),
    hasNpmignore: exists(join(cwd, '.npmignore')),
    publishability: [],
  };

  if (pkg.private) report.publishability.push({ level: 'error', text: '"private": true — this package cannot be published as-is.' });
  if (!pkg.description) report.publishability.push({ level: 'warn', text: 'missing description (npm search signal).' });
  if (report.keywords < 5) report.publishability.push({ level: 'warn', text: `only ${report.keywords} keywords (target 5–15).` });
  if (!pkg.repository) report.publishability.push({ level: 'warn', text: 'missing repository field.' });
  if (!ex.present && !pkg.main) report.publishability.push({ level: 'error', text: 'no exports and no main — consumers cannot resolve the package.' });
  if (ex.present && !ex.conditions.includes('import') && !ex.conditions.includes('default')) report.publishability.push({ level: 'error', text: 'exports has no import/default condition.' });
  if (ex.present && !ex.conditions.includes('require') && !ex.conditions.includes('default')) report.publishability.push({ level: 'error', text: 'exports has no require/default condition.' });
  if (!report.types && !report.typesVersions) report.publishability.push({ level: 'info', text: 'no types declared.' });
  if (report.sideEffects === null && ex.present) report.publishability.push({ level: 'info', text: 'sideEffects not declared (tree-shaking hint missing).' });
  if (!report.engines || !report.engines.node) report.publishability.push({ level: 'warn', text: 'engines.node missing.' });
  if (!files && !report.hasNpmignore) report.publishability.push({ level: 'warn', text: 'no files array and no .npmignore — tarball contents are implicit.' });
  if (!scripts.test) report.publishability.push({ level: 'warn', text: 'no test script.' });

  lines.push(`**${pkg.name}@${pkg.version}**${pkg.private ? ' (private)' : ''}`);
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| description | ${pkg.description ? 'present' : 'MISSING'} |`);
  lines.push(`| keywords | ${report.keywords} |`);
  lines.push(`| repository | ${pkg.repository ? 'present' : 'MISSING'} |`);
  lines.push(`| homepage | ${pkg.homepage ? 'present' : 'MISSING'} |`);
  lines.push(`| exports | ${ex.present ? `conditions: ${ex.conditions.join(', ') || 'none'}; subpaths: ${ex.subpaths.join(', ') || 'none'}` : 'MISSING'} |`);
  lines.push(`| types | ${report.types || (report.typesVersions ? 'typesVersions' : 'MISSING')} |`);
  lines.push(`| sideEffects | ${report.sideEffects === null ? 'not declared' : JSON.stringify(report.sideEffects)} |`);
  lines.push(`| engines | ${report.engines ? JSON.stringify(report.engines) : 'MISSING'} |`);
  lines.push(`| files | ${files ? files.join(', ') : '(implicit)'} |`);
  lines.push('');

  if (options.pack !== false) {
    const pack = packDryRun(cwd, resolved.path ? dirname(resolved.path) : cwd);
    if (pack.ok) {
      report.tarball = { fileCount: pack.fileCount, unpackedSize: pack.unpackedSize, files: pack.files };
      lines.push('## Tarball (npm pack --dry-run)');
      lines.push('');
      lines.push(`${pack.fileCount} files, ${Math.round((pack.unpackedSize || 0) / 1024)} KB unpacked.`);
      const suspicious = pack.files.filter((file) => /(^|\/)(\.env|\.npmrc|secrets?|id_rsa)(\.|$)/i.test(file) || /(^|\/)\.git(\/|$)/i.test(file));
      if (suspicious.length > 0) {
        lines.push('');
        lines.push(`⚠️ suspicious entries: ${suspicious.join(', ')}`);
      }
      const packageDir = resolved.path ? dirname(resolved.path) : cwd;
      const missing = ['llms.txt', 'llms-full.txt', 'AGENTS.md'].filter((name) => exists(join(packageDir, name)) && !pack.files.includes(name));
      if (missing.length > 0) {
        lines.push('');
        lines.push(`⚠️ present in the repo but not in the tarball: ${missing.join(', ')}`);
      }
      lines.push('');
      if (options.list) {
        lines.push('<details><summary>tarball contents</summary>');
        lines.push('');
        for (const file of pack.files) lines.push(`- ${file}`);
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    } else {
      lines.push(`## Tarball`);
      lines.push('');
      lines.push(`Skipped: ${pack.error}`);
      lines.push('');
    }
  }

  lines.push('## Publishability');
  lines.push('');
  if (report.publishability.length === 0) {
    lines.push('✅ No blocking issues found.');
  } else {
    for (const item of report.publishability) {
      const icon = item.level === 'error' ? '🔴' : item.level === 'warn' ? '🟡' : '🔵';
      lines.push(`${icon} ${item.text}`);
    }
  }
  lines.push('');
  lines.push('Note: `rdk npm-surface` never publishes. Publishing requires an explicit `npm publish` by a human.');
  lines.push('');

  const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : `${lines.join('\n')}`;
  return { ok: report.publishability.every((item) => item.level !== 'error'), output, report, exitCode: report.publishability.some((item) => item.level === 'error') ? 2 : 0 };
}
