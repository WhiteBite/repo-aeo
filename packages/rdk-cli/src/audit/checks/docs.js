/**
 * Axis 5 — Docs readiness: llms.txt / llms-full.txt, JSON-LD, link health.
 * Only applied when the project has a docs site or homepage configured.
 */
import { check, finding } from './_shared.js';
import { exists, readTextIfExists } from '../../util/fs.js';
import { generatedDrift } from '../../generate/index.js';
import { join } from 'node:path';

export const docsChecks = [
  check({
    id: 'docs.llms_txt',
    axis: 'docs',
    weight: 20,
    title: 'llms.txt exists at the repository root',
    why: 'llms.txt is the AI-friendly table of contents: when an agent asks about the project, a single small file delivers 2–10k tokens of clean context instead of parsing hundreds of kilobytes of HTML.',
    fix: 'Run `rdk fix` to generate llms.txt from .discoverability/project.yml + README, then edit the summary by hand.',
    effort: 'S',
    autoFixable: true,
    patchId: 'llms.generate',
    run(ctx) {
      if (!exists(join(ctx.cwd, 'llms.txt'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'llms.txt is missing', why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'llms.generate', weight: this.weight });
      }
      const text = readTextIfExists(join(ctx.cwd, 'llms.txt'));
      if (text.trim().length < 80) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'llms.txt is too thin to be useful', why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'llms.generate', weight: this.weight });
      }
      if (!/^#\s+/m.test(text)) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'llms.txt does not start with an H1 project title', why: 'The llms.txt convention expects an H1 title followed by a blockquote summary and then link lists.', fix: 'Follow the format at https://llmtxt.info/llms-txt-format/', effort: 'S', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'docs.llms_full',
    axis: 'docs',
    weight: 8,
    title: 'llms-full.txt exists (full documentation in one file)',
    why: 'llms-full.txt gives an agent the complete documentation in one fetch, which is what "grounding" looks like when the model has no prior knowledge of the project.',
    fix: 'Run `rdk fix` to generate llms-full.txt from the README and docs sources.',
    effort: 'S',
    autoFixable: true,
    patchId: 'llms.generate',
    run(ctx) {
      if (!exists(join(ctx.cwd, 'llms-full.txt'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'llms-full.txt is missing', why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'llms.generate', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'docs.quickstart_source',
    axis: 'docs',
    weight: 8,
    title: 'quickstart commands are configured',
    why: 'Every generated artifact (README, llms.txt, docs snippets) is derived from the quickstart block; empty commands produce hollow documentation.',
    fix: 'Fill quickstart.install / quickstart.run / quickstart.test in .discoverability/project.yml.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const { quickstart } = ctx.config;
      const missing = [];
      if (!quickstart.install) missing.push('install');
      if (!quickstart.run) missing.push('run');
      if (missing.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `quickstart is missing: ${missing.join(', ')}`, why: this.why, fix: this.fix, effort: 'S', weight: this.weight });
      }
      if (!Array.isArray(quickstart.prerequisites) || quickstart.prerequisites.length === 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'quickstart.prerequisites is empty', why: 'Prerequisites prevent the "it does not work on my machine" support loop.', fix: 'List the required runtimes and versions.', effort: 'S', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'docs.structured_data',
    axis: 'docs',
    weight: 10,
    title: 'Structured data (JSON-LD) is available for the site/docs',
    why: 'JSON-LD is the structured-data format Google recommends; it makes the project eligible for rich results and gives crawlers an unambiguous description of what the site is.',
    fix: 'Add a JSON-LD block (SoftwareSourceCode / WebSite) to the docs homepage, or keep a reviewed snippet in docs/jsonld.jsonld.',
    effort: 'M',
    autoFixable: true,
    patchId: 'jsonld.snippet',
    run(ctx) {
      const site = ctx.config.links.docs || ctx.config.links.homepage;
      if (!site) return null;
      const candidates = ['docs/index.html', 'index.html', 'docs/jsonld.jsonld', 'docs/jsonld.json', '.discoverability/jsonld.jsonld'];
      for (const candidate of candidates) {
        const path = join(ctx.cwd, candidate);
        if (!exists(path)) continue;
        const text = readTextIfExists(path);
        if (/application\/ld\+json/.test(text) || /"@context"\s*:/.test(text)) return null;
      }
      return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No JSON-LD structured data found for the site/docs', why: this.why, fix: 'Run `rdk fix` to emit a reviewed JSON-LD snippet, then embed it in the site.', effort: 'M', autoFixable: true, patchId: 'jsonld.snippet', weight: this.weight });
    },
  }),

  check({
    id: 'docs.link_health',
    axis: 'docs',
    weight: 10,
    title: 'Outbound links resolve',
    why: 'A dead docs link is a dead end for crawlers and agents; stale llms.txt with broken links actively misleads agents.',
    fix: 'Fix or remove the broken links reported by the audit (run with --online).',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      if (!ctx.options.online) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'Link health not checked (offline mode)', why: this.why, fix: 'Run `rdk audit --online` to probe outbound links.', effort: 'S', weight: this.weight });
      }
      const results = ctx.online && ctx.online.linkResults ? ctx.online.linkResults : [];
      const broken = results.filter((result) => !result.ok);
      if (broken.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: `${broken.length} broken outbound link(s)`, why: this.why, fix: `Broken: ${broken.slice(0, 5).map((b) => `${b.url} (${b.status || b.error})`).join(', ')}`, effort: 'M', weight: this.weight });
      }
      return null;
    },
  }),

  check({
    id: 'docs.readme_sync',
    axis: 'docs',
    weight: 6,
    title: 'Generated llms files match their sources',
    why: 'An out-of-date llms.txt is worse than none: agents trust it and quote stale facts. This is the check that keeps the AI-facing surface honest.',
    fix: 'Run `rdk fix` to regenerate the drifted files and commit them together with the source change.',
    effort: 'S',
    autoFixable: true,
    patchId: 'llms.generate',
    run(ctx) {
      const stale = generatedDrift(ctx.cwd, ctx.config, ctx.pkg);
      if (stale.length === 0) return null;
      return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `${stale.join(' and ')} drifted from the rendered output`, why: this.why, fix: this.fix, effort: 'S', autoFixable: true, patchId: 'llms.generate', weight: this.weight });
    },
  }),
];
