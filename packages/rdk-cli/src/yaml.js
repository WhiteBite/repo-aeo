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
      // single left-to-right pass: chained replace() would eat the second char of `\\n` as a newline
      let out = '';
      for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '\\' && i + 1 < body.length) {
          const next = body[i + 1];
          if (next === 'n') { out += '\n'; i += 1; continue; }
          if (next === 't') { out += '\t'; i += 1; continue; }
          if (next === '"') { out += '"'; i += 1; continue; }
          if (next === '\\') { out += '\\'; i += 1; continue; }
        }
        out += ch;
      }
      body = out;
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
    const close = t.lastIndexOf(']');
    if (close === -1) throw new YamlError('unterminated flow sequence');
    if (t.slice(close + 1).trim() !== '') throw new YamlError(`unexpected content after flow sequence: ${t.slice(close + 1).trim()}`);
    const inner = t.slice(1, close).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((item) => parseScalar(item));
  }
  if (t.startsWith('{')) {
    const close = t.lastIndexOf('}');
    if (close === -1) throw new YamlError('unterminated flow mapping');
    if (t.slice(close + 1).trim() !== '') throw new YamlError(`unexpected content after flow mapping: ${t.slice(close + 1).trim()}`);
    const inner = t.slice(1, close).trim();
    const out = {};
    if (inner === '') return out;
    for (const part of splitFlow(inner)) {
      const idx = part.indexOf(':');
      if (idx === -1) throw new YamlError(`flow mapping entry without a colon: ${part}`);
      out[String(parseScalar(part.slice(0, idx)))] = parseScalar(part.slice(idx + 1));
    }
    return out;
  }
  return parseScalar(t);
}

function parseBlockHeader(rest) {
  if (rest.length < 1 || (rest[0] !== '|' && rest[0] !== '>')) return null;
  let chomp = 'clip';
  let explicitIndent = 0;
  for (const ch of rest.slice(1)) {
    if (ch === '-') chomp = 'strip';
    else if (ch === '+') chomp = 'keep';
    else if (ch >= '1' && ch <= '9') explicitIndent = Number(ch);
    else return null;
  }
  return { style: rest[0], chomp, explicitIndent };
}

/**
 * Reads a block scalar from the raw (un-stripped) lines: comments and blank
 * lines inside the block are content, not syntax. Returns the 0-based raw
 * index of the first unconsumed line.
 */
function readBlockScalar(rawLines, startRaw, parentIndent, header) {
  const { style, chomp, explicitIndent } = header;
  let contentIndent = explicitIndent > 0 ? parentIndent + explicitIndent : null;
  const collected = [];
  let i = startRaw;
  while (i < rawLines.length) {
    const raw = rawLines[i];
    const isBlank = raw.trim() === '';
    if (isBlank) {
      collected.push(null);
      i += 1;
      continue;
    }
    const lineIndent = raw.length - raw.trimStart().length;
    if (contentIndent === null) {
      if (lineIndent <= parentIndent) break;
      contentIndent = lineIndent;
    }
    if (lineIndent < contentIndent) break;
    collected.push(raw.slice(contentIndent));
    i += 1;
  }
  let trailingBlanks = 0;
  while (collected.length > 0 && collected[collected.length - 1] === null) {
    collected.pop();
    trailingBlanks += 1;
  }
  let value;
  if (style === '>') {
    const paragraphs = [];
    let current = [];
    for (const item of collected) {
      if (item === null) {
        if (current.length > 0) { paragraphs.push(current); current = []; }
        continue;
      }
      if (item.startsWith(' ') || item.startsWith('\t')) {
        if (current.length > 0) { paragraphs.push(current); current = []; }
        paragraphs.push([item]);
        continue;
      }
      current.push(item);
    }
    if (current.length > 0) paragraphs.push(current);
    value = paragraphs.map((part) => part.join(' ')).join('\n');
  } else {
    value = collected.join('\n');
  }
  if (chomp === 'keep') value += '\n'.repeat(trailingBlanks);
  else if (chomp === 'clip' && collected.length > 0) value += '\n';
  return { value, endRaw: i };
}

function parseMap(lines, rawLines, i, indent) {
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
    const header = parseBlockHeader(rest);
    if (header) {
      const { value, endRaw } = readBlockScalar(rawLines, lines[i].number, indent, header);
      out[key] = value;
      let j = i + 1;
      while (j < lines.length && lines[j].number <= endRaw) j += 1;
      i = j;
      continue;
    }
    if (rest === '') {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const [value, after] = parseBlock(lines, rawLines, i + 1, next.indent);
        out[key] = value;
        i = after;
        continue;
      }
      if (next && next.indent === indent && next.text.startsWith('- ')) {
        const [value, after] = parseList(lines, rawLines, i + 1, indent);
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

function parseList(lines, rawLines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
    const text = lines[i].text.slice(2).trim();
    if (text.startsWith('- ') || text === '-') {
      throw new YamlError('nested block lists are not supported', lines[i].number);
    }
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
      if (parseBlockHeader(rest)) {
        throw new YamlError('block scalars inside list items are not supported', lines[i].number);
      }
      if (rest === '') {
        const next = lines[i + 1];
        if (next && next.indent > itemIndent) {
          const [value, after] = parseBlock(lines, rawLines, i + 1, next.indent);
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
        if (parseBlockHeader(subRest)) {
          throw new YamlError('block scalars inside list items are not supported', lines[i].number);
        }
        if (subRest === '') {
          const next = lines[i + 1];
          if (next && next.indent > lines[i].indent) {
            const [value, after] = parseBlock(lines, rawLines, i + 1, next.indent);
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

function parseBlock(lines, rawLines, i, indent) {
  if (lines[i].text.startsWith('- ') || lines[i].text === '-') {
    return parseList(lines, rawLines, i, indent);
  }
  return parseMap(lines, rawLines, i, indent);
}

/** Parses a YAML document (subset) into a plain JS value. */
export function parse(text) {
  const rawLines = String(text).split(/\r?\n/);
  const lines = [];
  for (let n = 0; n < rawLines.length; n += 1) {
    const noComment = stripComment(rawLines[n]).replace(/\s+$/, '');
    if (noComment.trim() === '') continue;
    const trimmed = noComment.trim();
    const indent = noComment.length - noComment.trimStart().length;
    if (indent === 0 && (trimmed === '---' || trimmed === '...')) {
      // `...` ends the document; a second `---` would start another one, which the subset rejects
      if (trimmed === '---' && lines.length > 0) throw new YamlError('multiple documents are not supported; rdk reads exactly one YAML document', n + 1);
      continue;
    }
    const leadingWhitespace = noComment.slice(0, indent);
    if (leadingWhitespace.indexOf(String.fromCharCode(9)) !== -1) {
      throw new YamlError('tabs are not allowed for indentation', n + 1);
    }
    lines.push({ indent, text: trimmed, number: n + 1 });
  }
  if (lines.length === 0) return {};
  const [value, end] = parseBlock(lines, rawLines, 0, lines[0].indent);
  if (end < lines.length) {
    throw new YamlError(`unexpected content "${lines[end].text}"`, lines[end].number);
  }
  return value;
}

export default { parse, YamlError };
