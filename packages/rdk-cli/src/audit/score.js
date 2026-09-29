/**
 * Discoverability Score: six weighted axes, renormalised over the axes that
 * actually apply to this project (a repo without an npm package is not
 * penalised for missing npm metadata).
 */

export const AXIS_WEIGHTS = {
  github: 20,
  readme: 25,
  agents: 15,
  npm: 20,
  docs: 12,
  hygiene: 8,
};

export const AXIS_LABELS = {
  github: 'GitHub metadata',
  readme: 'README primitives',
  agents: 'Agent readiness',
  npm: 'npm readiness',
  docs: 'Docs readiness',
  hygiene: 'Trust & hygiene',
};

export const AXIS_HINTS = {
  github: 'Repository description, homepage and 8–20 topics.',
  readme: 'First success path, examples, audience sections, sourced claims.',
  agents: 'AGENTS.md with working test/lint/build commands and do/don\'t rules.',
  npm: 'description, keywords, repository, exports, types, tarball hygiene.',
  docs: 'llms.txt / llms-full.txt, JSON-LD, healthy links (when a site exists).',
  hygiene: 'LICENSE, SECURITY.md, CONTRIBUTING.md, CODEOWNERS, no leaked secrets.',
};

export function grade(total) {
  if (total >= 90) return 'A';
  if (total >= 80) return 'B';
  if (total >= 70) return 'C';
  if (total >= 55) return 'D';
  return 'F';
}

/**
 * @param {Record<string, {passed:number, total:number}>} perAxis raw check tallies
 * @param {string[]} applicableAxes axes that apply to this project
 */
export function computeScore(perAxis, applicableAxes) {
  const axes = {};
  let weighted = 0;
  let weightSum = 0;

  for (const axis of Object.keys(AXIS_WEIGHTS)) {
    const tally = perAxis[axis] || { passed: 0, total: 0 };
    const applicable = applicableAxes.includes(axis) && tally.total > 0;
    const score = tally.total === 0 ? 0 : Math.round((tally.passed / tally.total) * 100);
    axes[axis] = {
      label: AXIS_LABELS[axis],
      hint: AXIS_HINTS[axis],
      score,
      weight: AXIS_WEIGHTS[axis],
      applicable,
      passed: tally.passed,
      total: tally.total,
    };
    if (applicable) {
      weighted += score * AXIS_WEIGHTS[axis];
      weightSum += AXIS_WEIGHTS[axis];
    }
  }

  const total = weightSum === 0 ? 0 : Math.round(weighted / weightSum);
  return { total, grade: grade(total), axes };
}
