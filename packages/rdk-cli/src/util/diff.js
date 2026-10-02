/** Minimal line diff for dry-run previews (no external diff library). */

// beyond this many changed lines on either side the LCS matrix is skipped for a whole-block diff
const LCS_LINE_CAP = 2000;

function lcsMatrix(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  return matrix;
}

/** Returns a list of { type: 'context'|'add'|'del', text } hunks. */
export function diffLines(beforeText, afterText) {
  const before = String(beforeText ?? '').split('\n');
  const after = String(afterText ?? '').split('\n');
  // trim the common prefix and suffix so the quadratic matrix only sees the changed middle
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }
  const midB = before.slice(start, endB);
  const midA = after.slice(start, endA);
  const ops = [];
  for (let i = 0; i < start; i += 1) ops.push({ type: 'context', text: before[i] });
  if (midB.length > LCS_LINE_CAP || midA.length > LCS_LINE_CAP) {
    for (const line of midB) ops.push({ type: 'del', text: line });
    for (const line of midA) ops.push({ type: 'add', text: line });
  } else {
    const matrix = lcsMatrix(midB, midA);
    let i = 0;
    let j = 0;
    while (i < midB.length && j < midA.length) {
      if (midB[i] === midA[j]) {
        ops.push({ type: 'context', text: midB[i] });
        i += 1;
        j += 1;
      } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
        ops.push({ type: 'del', text: midB[i] });
        i += 1;
      } else {
        ops.push({ type: 'add', text: midA[j] });
        j += 1;
      }
    }
    while (i < midB.length) {
      ops.push({ type: 'del', text: midB[i] });
      i += 1;
    }
    while (j < midA.length) {
      ops.push({ type: 'add', text: midA[j] });
      j += 1;
    }
  }
  for (let i = endB; i < before.length; i += 1) ops.push({ type: 'context', text: before[i] });
  return ops;
}

/** Renders a compact unified-style diff with 2 lines of context. */
export function unifiedDiff(beforeText, afterText, { path = 'file', context = 2 } = {}) {
  const ops = diffLines(beforeText, afterText);
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === 'context') {
      index += 1;
      continue;
    }
    const start = Math.max(0, index - context);
    let end = index;
    while (end < ops.length) {
      if (ops[end].type !== 'context') {
        end += 1;
        continue;
      }
      let lookahead = end;
      while (lookahead < ops.length && ops[lookahead].type === 'context') lookahead += 1;
      if (lookahead < ops.length && lookahead - end <= context * 2) {
        end = lookahead;
        continue;
      }
      break;
    }
    const stop = Math.min(ops.length, end + context);
    for (let k = start; k < stop; k += 1) {
      const op = ops[k];
      const prefix = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ';
      lines.push(`${prefix}${op.text}`);
    }
    index = stop;
  }
  return lines.join('\n');
}
