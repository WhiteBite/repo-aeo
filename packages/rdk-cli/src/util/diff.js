/** Minimal line diff for dry-run previews (no external diff library). */

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
  const matrix = lcsMatrix(before, after);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ type: 'context', text: before[i] });
      i += 1;
      j += 1;
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      ops.push({ type: 'del', text: before[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    ops.push({ type: 'del', text: before[i] });
    i += 1;
  }
  while (j < after.length) {
    ops.push({ type: 'add', text: after[j] });
    j += 1;
  }
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

export function countChanges(beforeText, afterText) {
  const ops = diffLines(beforeText, afterText);
  return {
    added: ops.filter((op) => op.type === 'add').length,
    removed: ops.filter((op) => op.type === 'del').length,
  };
}
