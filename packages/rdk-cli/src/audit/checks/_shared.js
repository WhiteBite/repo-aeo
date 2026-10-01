/**
 * Shared helpers for audit checks. Every check is a declarative definition:
 *   { id, axis, weight, severity-if-failing, title, why, fix, effort, autoFixable, patchId, run(ctx) }
 * A check passes when `run` returns null; otherwise it returns a Finding whose
 * severity may be escalated per context.
 */

export function finding({ id, axis, severity, title, why, fix, effort = 'S', autoFixable = false, patchId = null, weight, evidence = null }) {
  return { id, axis, severity, title, why, fix, effort, autoFixable, patchId, weight, evidence };
}

export function check({ id, axis, weight, title, why, fix, effort = 'S', autoFixable = false, patchId = null, run }) {
  return { id, axis, weight, title, why, fix, effort, autoFixable, patchId, run };
}

const SKIP_MARKER = Symbol('rdk.audit.skip');

/** A check whose subject is absent: excluded from both passed and total tallies. */
export function skip(reason) {
  return { [SKIP_MARKER]: true, reason: String(reason) };
}

export function isSkip(result) {
  return Boolean(result && typeof result === 'object' && result[SKIP_MARKER] === true);
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*$/;
const FENCE_RE = /^(?:```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/;

/** Parses a Markdown document into headings, sections, fenced code blocks and links. */
export function parseMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/);
  const headings = [];
  const codeBlocks = [];
  const links = [];
  let fence = null;
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      if (FENCE_RE.test(line)) {
        codeBlocks.push({ lang: fence.lang, code: fence.lines.join('\n'), line: fence.start, endLine: i + 1 });
        fence = null;
        current = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      fence = { lang: fenceMatch[1] || '', lines: [], start: i + 1 };
      continue;
    }
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const heading = { level: headingMatch[1].length, text: headingMatch[2].trim(), line: i + 1 };
      headings.push(heading);
      current = { heading, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);

    const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
    let match;
    while ((match = linkRe.exec(line)) !== null) {
      links.push({ url: match[1], line: i + 1 });
    }
    const bareRe = /(https?:\/\/[^\s)"'>]+)/g;
    while ((match = bareRe.exec(line)) !== null) {
      links.push({ url: match[0].replace(/[.,;:]$/, ''), line: i + 1 });
    }
  }

  const sections = new Map();
  for (const heading of headings) {
    const section = headings.find((h) => h.line > heading.line && h.level <= heading.level);
    const bodyLines = [];
    let inFence = false;
    for (let i = heading.line; i < lines.length; i += 1) {
      if (section && i + 1 >= section.line) break;
      if (FENCE_RE.test(lines[i])) {
        inFence = !inFence;
        bodyLines.push(lines[i]);
        continue;
      }
    }
    sections.set(normalizeHeading(heading.text), {
      heading,
      body: bodyLines.join('\n'),
      startLine: heading.line,
      endLine: section ? section.line - 1 : lines.length,
    });
  }

  return { lines, headings, codeBlocks, links, sections, raw: text };
}

export function normalizeHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Extracts the first N lines of a document as a single string. */
export function firstLines(text, n = 60) {
  return String(text || '').split(/\r?\n/).slice(0, n).join('\n');
}

const INSTALL_RE = /\b(npm\s+(i|install|add)|npx|yarn\s+add|pnpm\s+add|bun\s+add|pip\s+install|cargo\s+add|go\s+get|gem\s+install|apt(-get)?\s+install|brew\s+install|docker\s+(run|pull)|git\s+clone|curl\s+[^|]*\|\s*(ba)?sh)\b/i;
const RUN_RE = /\b(npm\s+(run|start|test)|npx\s+\S|yarn\s+(run|start|test)|pnpm\s+(run|start|test)|make\s+\S+|\.\/\S+|python\s+-m\s+\S+|cargo\s+run|go\s+run|node\s+\S+\.js)\b/i;

/** Detects an install/run command pair inside a fenced code block. */
export function hasFirstSuccessPath(markdown, withinLines = 60) {
  const head = firstLines(markdown, withinLines);
  const blocks = [];
  let fence = null;
  const lines = head.split(/\r?\n/);
  for (const line of lines) {
    const match = FENCE_RE.exec(line);
    if (match) {
      if (fence) {
        blocks.push(fence.join('\n'));
        fence = null;
      } else {
        fence = [];
      }
      continue;
    }
    if (fence) fence.push(line);
  }
  const install = blocks.some((block) => INSTALL_RE.test(block)) || INSTALL_RE.test(head);
  const run = blocks.some((block) => RUN_RE.test(block)) || RUN_RE.test(head);
  return { install, run, both: install && run };
}

/** Counts numeric claims (percentages, multipliers, benchmarks) in a document. */
export function countQuantifiedClaims(text) {
  const matches = String(text || '').match(/\b\d+(?:[.,]\d+)?\s*(?:%|x\b|ms\b|s\b|kb\b|mb\b|faster|slower|more|less|fewer|times)\b/gi);
  return matches ? matches.length : 0;
}

/** Extracts a canonical GitHub owner/repo from a URL. */
export function parseGithubUrl(url) {
  if (typeof url !== 'string') return null;
  const match = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?(?:[?#]|$)/i.exec(url);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function slugifyTopic(topic) {
  return String(topic || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function uniq(list) {
  return [...new Set(list)];
}
