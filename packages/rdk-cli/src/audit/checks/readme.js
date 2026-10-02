/**
 * Axis 2 — README primitives: first success path, examples, audience sections,
 * heading structure, verifiable claims, local link health.
 */
import { check, finding, skip, parseMarkdown, hasFirstSuccessPath, countQuantifiedClaims, normalizeHeading } from './_shared.js';
import { exists, readTextIfExists } from '../../util/fs.js';
import { join } from 'node:path';

const README_PATH_KEY = 'README.md';

function readmeText(ctx) {
  return ctx.readme ?? readTextIfExists(join(ctx.cwd, README_PATH_KEY));
}

function readmeDoc(ctx, text) {
  return ctx.readmeDoc ?? (text === null ? null : parseMarkdown(text));
}

const REQUIRED_SECTIONS = [
  { key: 'who is it for', label: 'Who is it for' },
  { key: 'use cases', label: 'Use cases' },
  { key: 'why choose this', label: 'Why choose this' },
  { key: 'status', label: 'Status / Roadmap' },
];

const STATUS_ALIASES = ['status', 'status roadmap', 'roadmap'];

export const readmeChecks = [
  check({
    id: 'readme.exists',
    axis: 'readme',
    weight: 10,
    title: 'README.md exists and is not empty',
    why: 'The README is the primary grounding document for both humans and agents. Without it, every downstream signal (npm page, search snippet, agent summary) is empty.',
    fix: 'Run `rdk init` to scaffold a README from .discoverability/project.yml.',
    effort: 'M',
    autoFixable: true,
    patchId: 'readme.generate',
    run(ctx) {
      if (!exists(join(ctx.cwd, 'README.md'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'README.md is missing', why: this.why, fix: this.fix, effort: this.effort });
      }
      const text = readmeText(ctx);
      if (text.trim().length < 200) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'README.md is nearly empty', why: this.why, fix: this.fix, effort: this.effort });
      }
      return null;
    },
  }),

  check({
    id: 'readme.first_success_path',
    axis: 'readme',
    weight: 15,
    title: 'Install + run commands appear in the first 60 lines',
    why: 'Readers (and agents summarising the repo) decide within seconds whether the project works for them. A first success path in the top of the README is the single highest-leverage README change.',
    fix: 'Move a copy-pasteable install + run block above the fold. Use the quickstart section of .discoverability/project.yml as the source of truth.',
    effort: 'S',
    autoFixable: true,
    patchId: 'readme.quickstart_stub',
    run(ctx) {
      const text = readmeText(ctx);
      if (text === null) return skip('README.md is missing');
      const path = hasFirstSuccessPath(text, 60);
      if (!path.install && !path.run) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'No install/run commands in the first 60 lines', why: this.why, fix: this.fix, effort: 'S' });
      }
      if (!path.both) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: path.install ? 'Run command missing near the top of README' : 'Install command missing near the top of README', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'readme.examples',
    axis: 'readme',
    weight: 12,
    title: 'README contains 2–5 short examples',
    why: 'Concrete examples are what agents copy into an answer ("here is how you use X"). Two to five focused examples beat one giant one.',
    fix: 'Add a "## Usage" or "## Examples" section with 2–5 short, runnable snippets.',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const text = readmeText(ctx);
      if (text === null) return skip('README.md is missing');
      const doc = readmeDoc(ctx, text);
      const exampleSection = ['usage', 'examples', 'example', 'quickstart', 'getting started'].map(normalizeHeading).find((key) => doc.sections.has(key));
      const blocks = exampleSection ? doc.sections.get(exampleSection).body.match(/^(?:```|~~~)/gm) : null;
      const exampleCount = blocks ? blocks.length / 2 : Math.min(doc.codeBlocks.length, 2);
      if (exampleCount === 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'No code examples in README', why: this.why, fix: this.fix, effort: 'M' });
      }
      if (exampleCount < 2) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'Only 1 example in README (target 2–5)', why: this.why, fix: this.fix, effort: 'M' });
      }
      if (doc.codeBlocks.length > 8) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: `${doc.codeBlocks.length} code blocks — consider trimming to the 5 most useful`, why: 'Example density helps, example noise hurts.', fix: 'Keep 2–5 canonical examples; move the rest to docs.', effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'readme.audience_sections',
    axis: 'readme',
    weight: 12,
    title: 'README answers who it is for, use cases, why choose it, status',
    why: 'These four sections are the retrieval hooks agents latch onto when matching a project to a user request ("who is it for" -> audience match, "why choose this" -> differentiation, "status" -> production readiness).',
    fix: 'Add the missing H2 sections: Who is it for, Use cases, Why choose this, Status.',
    effort: 'M',
    autoFixable: true,
    patchId: 'readme.sections_stub',
    run(ctx) {
      const text = readmeText(ctx);
      if (text === null) return skip('README.md is missing');
      const doc = readmeDoc(ctx, text);
      const present = REQUIRED_SECTIONS.filter((section) => {
        if (section.key === 'status') return STATUS_ALIASES.some((alias) => doc.sections.has(alias));
        return doc.sections.has(section.key);
      });
      const missing = REQUIRED_SECTIONS.filter((section) => !present.includes(section));
      if (missing.length === 0) return null;
      const severity = missing.length >= 3 ? 'error' : 'warn';
      return finding({
        id: this.id,
        axis: this.axis,
        severity,
        title: `Missing README sections: ${missing.map((s) => s.label).join(', ')}`,
        why: this.why,
        fix: 'Run `rdk fix` to insert section stubs, then fill them in.',
        effort: 'M',
      });
    },
  }),

  check({
    id: 'readme.heading_structure',
    axis: 'readme',
    weight: 6,
    title: 'README uses a clean H1/H2/H3 hierarchy',
    why: 'Extraction tools and agents build an outline from headings. A flat wall of text cannot be chunked, quoted or cited precisely.',
    fix: 'Give every major topic its own H2 and every sub-topic an H3.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const text = readmeText(ctx);
      if (text === null) return skip('README.md is missing');
      const doc = readmeDoc(ctx, text);
      const h2 = doc.headings.filter((h) => h.level === 2).length;
      const h1 = doc.headings.filter((h) => h.level === 1).length;
      if (h1 === 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'README has no H1 title', why: this.why, fix: 'Start the README with "# Project name".', effort: 'S' });
      }
      if (h2 < 4) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `README has only ${h2} H2 sections (target >= 4)`, why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'readme.verifiable_claims',
    axis: 'readme',
    weight: 6,
    title: 'README makes quantified, sourced claims',
    why: 'Content with checkable statistics and named sources gets materially more visibility in AI answers than adjective-heavy content. Numbers also survive summarisation intact.',
    fix: 'Replace "very fast" with "handles N ops/s on hardware X (benchmark link)".',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const text = readmeText(ctx);
      if (text === null) return skip('README.md is missing');
      const doc = readmeDoc(ctx, text);
      const claims = countQuantifiedClaims(text);
      const hasSourceLink = doc.links.some((link) => /^https?:\/\//.test(link.url));
      if (claims === 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No quantified claims in README', why: this.why, fix: this.fix, effort: 'M' });
      }
      if (!hasSourceLink) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'Quantified claims without any source link', why: this.why, fix: 'Link the benchmark, issue or docs page that backs each number.', effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'readme.local_links',
    axis: 'readme',
    weight: 4,
    title: 'Relative links in README resolve to real files',
    why: 'Broken relative links are the fastest way to make an agent (or a crawler) distrust the whole repository.',
    fix: 'Fix or remove the broken relative links reported below.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const text = readmeText(ctx);
      if (text === null) return skip('README.md is missing');
      const doc = readmeDoc(ctx, text);
      const broken = [];
      for (const link of doc.links) {
        const url = link.url.split('#')[0];
        if (!url || /^[a-z]+:/i.test(url) || url.startsWith('//')) continue;
        const target = url.replace(/^\.?\//, '');
        if (target === '') continue;
        let decoded = target;
        try {
          decoded = decodeURIComponent(target);
        } catch {
          decoded = target;
        }
        const path = join(ctx.cwd, decoded);
        if (!exists(path)) broken.push(link.url);
      }
      if (broken.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `${broken.length} broken relative link(s) in README`, why: this.why, fix: `Broken: ${[...new Set(broken)].slice(0, 5).join(', ')}`, effort: 'S' });
      }
      return null;
    },
  }),
];
