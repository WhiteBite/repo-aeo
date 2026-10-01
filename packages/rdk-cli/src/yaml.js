/**
 * Minimal dependency-free YAML parser for the .discoverability/project.yml subset.
 *
 * Supported: nested block maps, block lists of scalars, inline flow lists/maps,
 * quoted and plain scalars, booleans/numbers/null, block scalars (| and >),
 * comments. Anything outside that subset throws a descriptive error instead of
 * silently producing wrong data (wrong metadata is worse than a loud failure).
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'YamlError';
    this.line = line;
  }
}

const TRUE = new Set(['true', 'yes', 'on']);
const FALSE = new Set(['false', 'no', 'off']);

/** Removes a trailing `# comment`, honouring quotes and URLs with fragments. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function splitFlow(input) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of input) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.trim());
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return null;
  if (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    const q = s[0];
    let body = s.slice(1, -1);
    if (q === '"') {
      body = body
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else {
      body = body.replace(/''/g, "'");
    }
    return body;
  }
  if (s.startsWith('[') || s.startsWith('{')) return parseFlow(s);
  const low = s.toLowerCase();
  if (low === 'null' || low === '~') return null;
  if (TRUE.has(low)) return true;
  if (FALSE.has(low)) return false;
  if (/^[-+]?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number.parseFloat(s);
  return s;
}

function parseFlow(s) {
  const t = s.trim();
  if (t.startsWith('[')) {
    const inner = t.slice(1, t.lastIndexOf(']')).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((item) => parseScalar(item));
  }
  if (t.startsWith('{')) {
    const inner = t.slice(1, t.lastIndexOf('}')).trim();
    const out = {};
    if (inner === '') return out;
    for (const part of splitFlow(inner)) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      out[String(parseScalar(part.slice(0, idx)))] = parseScalar(part.slice(idx + 1));
    }
    return out;
  }
  return parseScalar(t);
}

function readBlockScalar(lines, i, parentIndent, header) {
  const folded = header.startsWith('>');
  const chomp = header.includes('-') ? 'strip' : 'clip';
  const body = [];
  while (i < lines.length && lines[i].indent > parentIndent) {
    body.push(' '.repeat(Math.max(0, lines[i].indent - parentIndent - 2)) + lines[i].text);
    i += 1;
  }
  let value = folded ? body.join(' ') : body.join('\n');
  if (chomp === 'clip') value += '\n';
  return { value, next: i };
}

function parseMap(lines, i, indent) {
  const out = {};
  while (i < lines.length && lines[i].indent >= indent) {
    if (lines[i].indent > indent) {
      throw new YamlError(`unexpected indentation`, lines[i].number);
    }
    const text = lines[i].text;
    if (text.startsWith('- ')) break;
    const match = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(text);
    if (!match) {
      throw new YamlError(`expected "key: value", got "${text}"`, lines[i].number);
    }
    const key = String(parseScalar(match[1]));
    const rest = match[2] === undefined ? '' : match[2].trim();
    if (/^[|>][-+]?\d*$/.test(rest)) {
      const { value, next } = readBlockScalar(lines, i + 1, indent, rest);
      out[key] = value;
      i = next;
      continue;
    }
    if (rest === '') {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const [value, after] = parseBlock(lines, i + 1, next.indent);
        out[key] = value;
        i = after;
        continue;
      }
      if (next && next.indent === indent && next.text.startsWith('- ')) {
        const [value, after] = parseList(lines, i + 1, indent);
        out[key] = value;
        i = after;
        continue;
      }
      out[key] = null;
      i += 1;
      continue;
    }
    out[key] = parseScalar(rest);
    i += 1;
  }
  return [out, i];
}

function parseList(lines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
    const text = lines[i].text.slice(2).trim();
    if (/^"(?:[^"\\]|\\.)*"$/.test(text) || /^'(?:[^']|'')*'$/.test(text)) {
      out.push(parseScalar(text));
      i += 1;
      continue;
    }
    const match = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(text);
    if (match) {
      // list of maps: `- key: value` with possible nested keys below
      const item = {};
      const key = String(parseScalar(match[1]));
      const rest = match[2] === undefined ? '' : match[2].trim();
      const itemIndent = indent + 2;
      if (rest === '') {
        const next = lines[i + 1];
        if (next && next.indent > itemIndent) {
          const [value, after] = parseBlock(lines, i + 1, next.indent);
          item[key] = value;
          i = after;
        } else {
          item[key] = null;
          i += 1;
        }
      } else {
        item[key] = parseScalar(rest);
        i += 1;
      }
      while (i < lines.length && lines[i].indent > indent && !lines[i].text.startsWith('- ')) {
        const sub = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(lines[i].text);
        if (!sub) break;
        const subKey = String(parseScalar(sub[1]));
        const subRest = sub[2] === undefined ? '' : sub[2].trim();
        if (subRest === '') {
          const next = lines[i + 1];
          if (next && next.indent > lines[i].indent) {
            const [value, after] = parseBlock(lines, i + 1, next.indent);
            item[subKey] = value;
            i = after;
            continue;
          }
          item[subKey] = null;
          i += 1;
          continue;
        }
        item[subKey] = parseScalar(subRest);
        i += 1;
      }
      out.push(item);
      continue;
    }
    out.push(parseScalar(text));
    i += 1;
  }
  return [out, i];
}

function parseBlock(lines, i, indent) {
  if (lines[i].text.startsWith('- ') || lines[i].text === '-') {
    return parseList(lines, i, indent);
  }
  return parseMap(lines, i, indent);
}

/** Parses a YAML document (subset) into a plain JS value. */
export function parse(text) {
  const lines = [];
  const rawLines = String(text).split(/\r?\n/);
  for (let n = 0; n < rawLines.length; n += 1) {
    const noComment = stripComment(rawLines[n]).replace(/\s+$/, '');
    if (noComment.trim() === '') continue;
    if (noComment.trim() === '---' || noComment.trim() === '...') continue;
    const indent = noComment.length - noComment.trimStart().length;
    const leadingWhitespace = noComment.slice(0, indent);
    if (leadingWhitespace.indexOf(String.fromCharCode(9)) !== -1) {
      throw new YamlError('tabs are not allowed for indentation', n + 1);
    }
    lines.push({ indent, text: noComment.trim(), number: n + 1 });
  }
  if (lines.length === 0) return {};
  const [value, end] = parseBlock(lines, 0, lines[0].indent);
  if (end < lines.length) {
    throw new YamlError(`unexpected content "${lines[end].text}"`, lines[end].number);
  }
  return value;
}

export default { parse, YamlError };
