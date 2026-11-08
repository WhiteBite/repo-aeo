/**
 * Axis 6 — Trust & hygiene: LICENSE, SECURITY.md, CONTRIBUTING.md, CODEOWNERS,
 * gitignore/gitattributes, CITATION.cff, issue templates and a local secrets
 * heuristic over the most recent commits.
 */
import { check, finding, skip } from './_shared.js';
import { exists, listFiles, readTextIfExists } from '../../util/fs.js';
import { citationVersionDrift, citationRepositoryDrift, dependabotEcosystems, renderFundingYml, FUNDING_MARKER } from '../../generate/index.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { recentCommits } from '../../util/git.js';

const SECRET_PATTERNS = [
  { id: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { id: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, label: 'private key block' },
  { id: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/, label: 'GitHub token' },
  { id: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: 'Slack token' },
  { id: 'npm_token', re: /\bnpm_[A-Za-z0-9]{36}\b/, label: 'npm token' },
  { id: 'generic_secret', re: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9/+_=-]{16,}['"]/i, label: 'hardcoded credential' },
];

const BINARY_ASSET_RE = /\.(png|gif|jpe?g|webp|mp4)$/i;
const CATCH_ALL_PATTERNS = new Set(['*', '**', '/*']);
const BINARY_ATTRS = new Set(['binary', '-text', 'text=false']);

function gitattributesRules(text) {
  const rules = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === '' || line.startsWith('#')) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    rules.push({ pattern, attrs, index });
  }
  return rules;
}

// text=auto and a bare `auto` spare binaries; only an explicit text/text=true forces them
function forcesText(attrs) {
  if (attrs.includes('auto') || attrs.includes('text=auto')) return false;
  return attrs.includes('text') || attrs.includes('text=true');
}

function isBinaryException(rule) {
  return BINARY_ASSET_RE.test(rule.pattern) && rule.attrs.some((attr) => BINARY_ATTRS.has(attr));
}

export const hygieneChecks = [
  check({
    id: 'hygiene.license',
    axis: 'hygiene',
    weight: 15,
    title: 'LICENSE file present',
    why: 'Without a license the project legally cannot be reused, and agents that check reuse permissions skip it entirely.',
    fix: 'Run `rdk fix` to add an MIT LICENSE stub, or add a LICENSE file by hand (MIT/Apache-2.0 are the safest defaults for tooling).',
    effort: 'S',
    autoFixable: true,
    patchId: 'license.stub',
    run(ctx) {
      const names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
      const dirs = [ctx.cwd, join(ctx.cwd, '.github'), join(ctx.cwd, 'docs')];
      const found = exists(join(ctx.cwd, 'COPYING')) || dirs.some((dir) => names.some((name) => exists(join(dir, name))));
      if (!found) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: 'No LICENSE file', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.security_policy',
    axis: 'hygiene',
    weight: 4,
    title: 'SECURITY.md present',
    why: 'A security policy tells researchers (and agents auditing dependencies) how to report issues privately — a visible maturity signal.',
    fix: 'Run `rdk fix` to add a SECURITY.md stub with a private reporting channel, then review the supported-versions table.',
    effort: 'S',
    autoFixable: true,
    patchId: 'security.stub',
    run(ctx) {
      const candidates = [join(ctx.cwd, 'SECURITY.md'), join(ctx.cwd, '.github', 'SECURITY.md'), join(ctx.cwd, 'docs', 'SECURITY.md')];
      if (!candidates.some((path) => exists(path))) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No SECURITY.md', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.contributing',
    axis: 'hygiene',
    weight: 6,
    title: 'CONTRIBUTING.md present',
    why: 'Contribution guidelines convert readers into contributors, and contributor activity is one of the strongest long-term recommendation signals.',
    fix: 'Run `rdk fix` to add a CONTRIBUTING.md stub covering setup, tests and the PR process.',
    effort: 'S',
    autoFixable: true,
    patchId: 'contributing.stub',
    run(ctx) {
      if (!exists(join(ctx.cwd, 'CONTRIBUTING.md')) && !exists(join(ctx.cwd, '.github', 'CONTRIBUTING.md')) && !exists(join(ctx.cwd, 'docs', 'CONTRIBUTING.md'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No CONTRIBUTING.md', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.code_of_conduct',
    axis: 'hygiene',
    weight: 4,
    title: 'CODE_OF_CONDUCT.md present',
    why: 'GitHub counts a code of conduct toward the community profile; it signals a moderated project that contributors and recommenders trust.',
    fix: 'Run `rdk fix` to add the Contributor Covenant 2.1, then review the enforcement contact channel.',
    effort: 'S',
    autoFixable: true,
    patchId: 'coc.stub',
    run(ctx) {
      const dirs = [ctx.cwd, join(ctx.cwd, '.github'), join(ctx.cwd, 'docs')];
      if (dirs.some((dir) => exists(join(dir, 'CODE_OF_CONDUCT.md')))) return null;
      return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No CODE_OF_CONDUCT.md', why: this.why, fix: this.fix, effort: 'S' });
    },
  }),

  check({
    id: 'hygiene.codeowners',
    axis: 'hygiene',
    weight: 5,
    title: 'CODEOWNERS present',
    why: 'Code owners make review routing automatic, which keeps the project responsive — a maintenance signal that both humans and scoring APIs notice.',
    fix: 'Run `rdk fix` to create .github/CODEOWNERS with a default owner, then replace it with the real owners.',
    effort: 'S',
    autoFixable: true,
    patchId: 'github.templates',
    run(ctx) {
      const candidates = [join(ctx.cwd, '.github', 'CODEOWNERS'), join(ctx.cwd, 'CODEOWNERS'), join(ctx.cwd, 'docs', 'CODEOWNERS')];
      if (!candidates.some((path) => exists(path))) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No CODEOWNERS file', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.gitignore',
    axis: 'hygiene',
    weight: 6,
    title: '.gitignore covers build output and dependencies',
    why: 'Committed build artefacts and node_modules make the repository harder to navigate for agents and pollute search results.',
    fix: 'Add .gitignore entries for node_modules/, dist/ and OS files.',
    effort: 'S',
    autoFixable: true,
    patchId: 'gitignore.entries',
    run(ctx) {
      const path = join(ctx.cwd, '.gitignore');
      if (!exists(path)) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No .gitignore', why: this.why, fix: this.fix, effort: 'S' });
      }
      const text = readTextIfExists(path);
      const entries = text.split(/\r?\n/).map((line) => line.trim());
      const required = ['node_modules/', 'dist/'];
      const missing = required.filter((entry) => {
        const bare = entry.replace(/\/$/, '');
        return !entries.some((line) => line === entry || line === bare);
      });
      if (missing.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: `.gitignore is missing: ${missing.join(', ')}`, why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.gitattributes',
    axis: 'hygiene',
    weight: 4,
    title: '.gitattributes present',
    why: 'Line-ending normalisation keeps diffs clean across platforms, which keeps history readable for reviewers and agents.',
    fix: 'Add a .gitattributes with `* text=auto eol=lf`.',
    effort: 'S',
    autoFixable: true,
    patchId: 'gitattributes.stub',
    run(ctx) {
      if (!exists(join(ctx.cwd, '.gitattributes'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No .gitattributes', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.gitattributes_binaries',
    axis: 'hygiene',
    weight: 4,
    title: 'No catch-all text rule corrupts committed binary assets',
    why: 'A catch-all `* text` rule makes git rewrite binary blobs at commit time (CRLF->LF), so committed PNG/GIF assets are corrupted and README images render broken on GitHub even though the worktree file is fine.',
    fix: 'Add a `*.png binary` line (and one per other shipped binary extension) after the catch-all rule, then `git add` the assets to re-store them unnormalized.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const path = join(ctx.cwd, '.gitattributes');
      if (!exists(path)) return null;
      const rules = gitattributesRules(readTextIfExists(path));
      let lastForce = -1;
      for (const rule of rules) {
        if (CATCH_ALL_PATTERNS.has(rule.pattern) && forcesText(rule.attrs)) lastForce = rule.index;
      }
      if (lastForce === -1) return null;
      if (rules.some((rule) => rule.index > lastForce && isBinaryException(rule))) return null;
      const assets = listFiles(ctx.cwd, { recursive: true, maxDepth: 4 }).filter((file) => BINARY_ASSET_RE.test(file));
      if (assets.length === 0) return null;
      const extensions = [...new Set(assets.map((file) => file.slice(file.lastIndexOf('.')).toLowerCase()))];
      const fix = `Add ${extensions.map((ext) => `\`*${ext} binary\``).join(', ')} after the catch-all rule, then \`git add\` the assets to re-store them unnormalized.`;
      return finding({ id: this.id, axis: this.axis, severity: 'warn', title: this.title, why: this.why, fix, effort: this.effort });
    },
  }),

  check({
    id: 'hygiene.dependabot',
    axis: 'hygiene',
    weight: 4,
    title: 'dependabot.yml present',
    why: 'Automated dependency updates close known CVEs quickly; a stale dependency tree is a trust signal that scanners and reviewers notice.',
    fix: 'Run `rdk fix` to create .github/dependabot.yml with weekly updates for the detected ecosystems.',
    effort: 'S',
    autoFixable: true,
    patchId: 'dependabot.stub',
    run(ctx) {
      if (exists(join(ctx.cwd, '.github', 'dependabot.yml'))) return null;
      if (dependabotEcosystems(ctx.cwd, ctx.pkg).length === 0) return skip('no package ecosystem or workflows directory detected');
      return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No dependabot.yml', why: this.why, fix: this.fix, effort: 'S' });
    },
  }),

  check({
    id: 'hygiene.citation',
    axis: 'hygiene',
    weight: 6,
    title: 'CITATION.cff present (research, libraries and datasets)',
    why: 'CITATION.cff makes the project citable in one click from the GitHub "Cite this repository" button — a direct academic discoverability lever.',
    fix: 'Add CITATION.cff with title, authors, version and license.',
    effort: 'S',
    autoFixable: true,
    patchId: 'citation.stub',
    run(ctx) {
      const relevant = ['library', 'research', 'dataset', 'tool', 'app'].includes(String(ctx.config.project.category || '').toLowerCase());
      if (!relevant) return null;
      if (!exists(join(ctx.cwd, 'CITATION.cff'))) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No CITATION.cff', why: this.why, fix: this.fix, effort: 'S' });
      }
      const drift = citationVersionDrift(ctx.cwd, ctx.config, ctx.pkg);
      if (drift) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: `CITATION.cff version is stale: ${drift.current}, package is ${drift.expected}`, why: 'A citation pinned to an old version misleads readers and citation indexes about which release the metadata describes.', fix: 'Run `rdk fix` to refresh the version key from package.json; every other field is left untouched.', effort: 'S' });
      }
      const repositoryDrift = citationRepositoryDrift(ctx.cwd, ctx.config, ctx.pkg);
      if (repositoryDrift) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'CITATION.cff repository-code is empty while a repository URL is derivable', why: 'repository-code connects the citation back to the source repository; an empty value leaves readers and citation indexes with metadata and no code behind it.', fix: 'Run `rdk fix` to fill repository-code from package.json or the git remote; every other field is left untouched.', effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.issue_templates',
    axis: 'hygiene',
    weight: 5,
    title: 'Issue and PR templates present',
    why: 'Templates raise the quality of incoming issues, which reduces maintainer load — the maintenance signal that scoring APIs reward.',
    fix: 'Add .github/ISSUE_TEMPLATE/ and PULL_REQUEST_TEMPLATE.md.',
    effort: 'S',
    autoFixable: true,
    patchId: 'github.templates',
    run(ctx) {
      const hasIssues = exists(join(ctx.cwd, '.github', 'ISSUE_TEMPLATE'));
      const hasPr = exists(join(ctx.cwd, '.github', 'PULL_REQUEST_TEMPLATE.md')) || exists(join(ctx.cwd, 'PULL_REQUEST_TEMPLATE.md'));
      if (!hasIssues && !hasPr) {
        return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No issue or PR templates', why: this.why, fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.secrets_heuristic',
    axis: 'hygiene',
    weight: 12,
    title: 'No obvious secrets in the most recent commits',
    why: 'A leaked credential is an instant trust and security failure. This is a heuristic over the last N commits, not a full history scan.',
    fix: 'Rotate the exposed credential, then purge it from history (git filter-repo) and force-push — with the maintainer\'s explicit acknowledgement.',
    effort: 'L',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const depth = Number(ctx.options.secretsDepth || 20);
      const commits = recentCommits(ctx.cwd, depth);
      const hits = [];
      for (const commit of commits) {
        const text = `${commit.subject}\n${commit.body}`;
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.re.test(text)) {
            hits.push({ commit: commit.hash.slice(0, 8), pattern: pattern.label, subject: commit.subject.slice(0, 80) });
          }
        }
      }
      if (hits.length > 0) {
        return finding({ id: this.id, axis: this.axis, severity: 'error', title: `${hits.length} potential secret(s) in the last ${commits.length} commits`, why: this.why, fix: `First hit: ${hits[0].pattern} in ${hits[0].commit} ("${hits[0].subject}")`, effort: 'L' });
      }
      return null;
    },
  }),

  check({
    id: 'hygiene.ci',
    axis: 'hygiene',
    weight: 8,
    title: 'A CI workflow runs on the repository',
    why: 'A CI workflow is the single strongest predictor of maintenance quality (Octoverse: repos with an agent config log 8x commits; npm research: CI-tests correlate with fewer vulnerabilities); a repo with no workflow cannot be verified by contributors or agents.',
    fix: 'Add a workflow under .github/workflows/ that runs the test command.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      let entries;
      try {
        entries = readdirSync(join(ctx.cwd, '.github', 'workflows'), { withFileTypes: true });
      } catch {
        entries = [];
      }
      if (entries.some((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))) return null;
      return finding({ id: this.id, axis: this.axis, severity: 'warn', title: 'No CI workflow found', why: this.why, fix: this.fix, effort: 'S' });
    },
  }),

  check({
    id: 'hygiene.funding',
    axis: 'hygiene',
    weight: 3,
    title: 'Funding surface matches the config',
    why: 'An opt-in funding surface (FUNDING.yml plus the npm funding field) lets users support the project. Deliberately not scored: it is a sustainability lever, not a discoverability one.',
    fix: 'Run `rdk fix` to write .github/FUNDING.yml and the package.json funding field from the funding section.',
    effort: 'S',
    autoFixable: true,
    patchId: 'funding.github',
    run(ctx) {
      const funding = ctx.config.funding || {};
      if (!funding.enabled) return null;
      const expected = renderFundingYml(ctx.config);
      if (expected === null) return null;
      const path = join(ctx.cwd, '.github', 'FUNDING.yml');
      if (!exists(path)) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'No .github/FUNDING.yml', why: this.why, fix: this.fix, effort: 'S' });
      }
      const current = readTextIfExists(path);
      if (current.startsWith(FUNDING_MARKER) && current !== expected) {
        return finding({ id: this.id, axis: this.axis, severity: 'info', title: 'FUNDING.yml is out of date with the config', why: 'The funding section changed after the file was generated, so the Sponsor button no longer reflects the config.', fix: this.fix, effort: 'S' });
      }
      return null;
    },
  }),
];
