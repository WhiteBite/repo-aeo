/**
 * Write guards shared by every distribution write: the acknowledgement string,
 * an auditable reason, and a plan digest that binds the write to the approved
 * preview.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_ACK = 'I_ACK_RDK_GITHUB_WRITE';

export const ACK_HINT =
  'the acknowledgement string configured for this repository (safety.ack in .discoverability/project.yml; the default is documented in the package README)';

/** The ack a caller must present: safety.ack when set to a non-empty string, else the built-in default. */
export function effectiveAck(config) {
  const configured = config && config.safety && config.safety.ack;
  return typeof configured === 'string' && configured !== '' ? configured : DEFAULT_ACK;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** sha256 hex of the canonical JSON (sorted keys) of a plan, so an approved preview can be pinned. */
export function planDigest(plan) {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

/**
 * Enforces the write-guard chain in a fixed order: ack -> reason (>= 5 chars)
 * -> plan_digest present -> digest match. Guards apply only when
 * options.apply is set; the digest match runs only when a plan is passed, so
 * a command can guard before its plan exists and bind the write after
 * building it. Every failure carries a stable code.
 */
export function assertWriteGuards({ options, config, plan }) {
  if (!options || !options.apply) return { ok: true };
  if (String(options.ack || '') !== effectiveAck(config)) {
    return { ok: false, code: 'ack_mismatch', error: `refusing to write: --ack must equal ${ACK_HINT}` };
  }
  if (!options.reason || String(options.reason).trim().length < 5) {
    return { ok: false, code: 'reason_required', error: 'refusing to write: a non-trivial reason is required and is logged' };
  }
  if (options.plan_digest === undefined || options.plan_digest === null || String(options.plan_digest).trim() === '') {
    return {
      ok: false,
      code: 'plan_digest_required',
      error: 'refusing to write: --plan-digest is required - run the dry-run preview first and pass its Plan digest with --plan-digest',
    };
  }
  if (plan !== undefined && plan !== null && String(options.plan_digest) !== planDigest(plan)) {
    return {
      ok: false,
      code: 'plan_digest_mismatch',
      error: 'refusing to write: plan_digest mismatch - re-run the preview and approve the new plan',
    };
  }
  return { ok: true };
}
