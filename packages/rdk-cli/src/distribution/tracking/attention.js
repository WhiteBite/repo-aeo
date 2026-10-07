const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const CHECK_PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'STALE']);
const CONTEXT_FAIL = new Set(['ERROR', 'FAILURE']);
const CONTEXT_PENDING = new Set(['EXPECTED', 'PENDING']);
const TERMINAL_STATUSES = new Set(['rejected', 'closed', 'unlisted', 'failed']);
const MS_PER_DAY = 86400000;

export function isMaintainer(association) {
  return MAINTAINERS.has(association);
}

export function countChecks(rollup) {
  const counts = { pass: 0, fail: 0, pending: 0 };
  if (!Array.isArray(rollup)) return counts;
  for (const node of rollup) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.status === 'string') {
      if (node.status !== 'COMPLETED') counts.pending += 1;
      else if (CHECK_PASS.has(node.conclusion)) counts.pass += 1;
      else counts.fail += 1;
      continue;
    }
    if (typeof node.state === 'string') {
      if (node.state === 'SUCCESS') counts.pass += 1;
      else if (CONTEXT_FAIL.has(node.state)) counts.fail += 1;
      else if (CONTEXT_PENDING.has(node.state)) counts.pending += 1;
    }
  }
  return counts;
}

function changesRequested(state) {
  if (state.review_decision === 'CHANGES_REQUESTED') return true;
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  return reviews.some((review) => review && isMaintainer(review.authorAssociation) && review.state === 'CHANGES_REQUESTED');
}

function maintainerCommentAfterPush(state) {
  const comments = Array.isArray(state.comments) ? state.comments : [];
  return comments.some((comment) => comment && isMaintainer(comment.authorAssociation) && comment.createdAt > (state.last_push || ''));
}

function ageInDays(then, now) {
  if (!then || !now) return NaN;
  const elapsed = Date.parse(now) - Date.parse(then);
  return Number.isNaN(elapsed) ? NaN : elapsed / MS_PER_DAY;
}

export function evaluateAttention(hydrated, entry, ctx) {
  const { hasLive, now, staleDays = 7 } = ctx || {};
  if (hasLive && hydrated && typeof hydrated.presence === 'string') {
    return hydrated.presence === 'listed' ? 'listed' : 'terminal';
  }
  if (!hasLive || !hydrated) {
    const status = entry && entry.status;
    if (status === 'listed') return 'listed';
    return TERMINAL_STATUSES.has(status) ? 'terminal' : 'none';
  }
  if (hydrated.state === 'MERGED') return 'listed';
  if (hydrated.state === 'CLOSED') return 'terminal';
  if (hydrated.state === 'OPEN') {
    const checks = hydrated.checks || {};
    const failing = checks.fail > 0;
    const conflicting = hydrated.merge_state === 'BEHIND' || hydrated.merge_state === 'DIRTY';
    if (changesRequested(hydrated) || failing || conflicting || maintainerCommentAfterPush(hydrated)) return 'action_required';
    if (hydrated.review_decision === 'APPROVED' && !failing && !conflicting) return 'approved';
    if (ageInDays(hydrated.updatedAt || hydrated.last_push, now) > staleDays) return 'stale';
    return 'awaiting_review';
  }
  return 'none';
}

export function neededFor(attention, hydrated) {
  if (attention === 'action_required') {
    const state = hydrated || {};
    const checks = state.checks || {};
    const codes = [];
    if (changesRequested(state)) codes.push('address_review');
    if (checks.fail > 0) codes.push('fix_checks');
    if (state.merge_state === 'BEHIND' || state.merge_state === 'DIRTY') codes.push('rebase');
    return codes;
  }
  if (attention === 'awaiting_review') return ['await_review'];
  if (attention === 'approved') return ['merge'];
  if (attention === 'listed') return hydrated && typeof hydrated.presence === 'string' ? [] : ['cleanup_fork'];
  if (attention === 'stale') return ['refresh'];
  return [];
}

export function commandFor(item, ctx) {
  const row = item || {};
  if (row.attention === 'action_required') {
    return `rdk submit --channel ${row.channel} --targets ${row.target} --category "<CATEGORY>" --apply --ack <ACK> --reason "address review" --plan-digest <DIGEST>`;
  }
  if (row.attention === 'approved') return `gh pr merge ${row.pr_url} --squash`;
  if (row.attention === 'listed' && row.fork) return `gh repo delete ${row.fork} --yes`;
  return '';
}