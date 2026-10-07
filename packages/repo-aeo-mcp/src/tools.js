/**
 * Tool registry for repo-aeo-mcp.
 *
 * Naming follows [service]_[action]_[object] in snake_case; descriptions are
 * 1-2 sentences and pagination/filter details live in the JSON Schema.
 * Every tool is read-only except `github_sync_metadata`, which requires an
 * acknowledgement string and an auditable reason.
 */
import { spawnSync } from 'node:child_process';
import {
  audit,
  loadConfig,
  resolvePackage,
  githubSyncCommand,
  effectiveAck,
  TOOL_HOME,
  llmsFreshness,
  httpGetText,
  channelById,
  recommend,
  buildDistributionStatus,
  readLedger,
  applySync,
  hydrateByProbe,
  discoverOwnedPrs,
  matchAdoptable,
  adoptRows,
  planDigest,
} from 'repo-aeo';
import { record, trend, series } from './history.js';

const USER_AGENT = `repo-aeo-mcp/0.1 (+${TOOL_HOME})`;

const httpGet = (url, options = {}) => httpGetText(url, { ...options, userAgent: USER_AGENT });

// the repo-aeo engine invokes gh synchronously; an async runner would silently disable every live probe
function gh(args, { cwd, input } = {}) {
  try {
    const result = spawnSync('gh', args, { cwd, timeout: 20000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, input });
    if (result.error) return { ok: false, stdout: '', stderr: String(result.error.message), code: null };
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status };
  } catch (error) {
    return { ok: false, stdout: '', stderr: String(error && error.message), code: null };
  }
}

const ghFor = (context) => (context && typeof context.gh === 'function' ? context.gh : gh);

// undefined keeps the verifiers' global-fetch fallback for real clients
const fetchFor = (context) => (context && typeof context.fetchImpl === 'function' ? context.fetchImpl : undefined);

function resolveCwd(args, context = {}) {
  if (typeof args.cwd === 'string' && args.cwd !== '') return args.cwd;
  if (typeof context.cwd === 'string' && context.cwd !== '') return context.cwd;
  return process.cwd();
}

// consecutive calls in one serve session share one audit run: the engine's spawn cost is per-audit
const AUDIT_CACHE_TTL_MS = 5000;
const auditCache = new Map();

function cachedAudit(cwd, online) {
  const key = `${cwd}|${online ? '1' : '0'}`;
  const hit = auditCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.promise;
  const promise = audit(cwd, { online }).then(
    (report) => {
      auditCache.set(key, { expires: Date.now() + AUDIT_CACHE_TTL_MS, promise });
      return report;
    },
    (error) => {
      auditCache.delete(key);
      throw error;
    },
  );
  auditCache.set(key, { expires: Number.POSITIVE_INFINITY, promise });
  return promise;
}

/**
 * Extracts the actionable line from a `rdk github-sync` transcript, so a
 * refusal that only explained itself in prose still yields a usable error.
 */
function firstReasonLine(output) {
  if (typeof output !== 'string') return null;
  const line = output
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry !== '' && !entry.startsWith('#') && !entry.startsWith('-') && !entry.startsWith('`'));
  return line || null;
}

/** First markdown H1 of a served llms.txt body; the BOM strip is for the curl path, which passes raw bytes through. */
export function firstHeadingOf(text) {
  const body = String(text).charCodeAt(0) === 0xfeff ? String(text).slice(1) : String(text);
  return (/^#\s+(.+)$/m.exec(body) || [])[1] || null;
}

function driftMsRecommendation(driftMs) {
  return driftMs < 3600000
    ? 'sources changed within the last hour - regenerate llms.txt with `rdk fix` so the change is captured'
    : 'regenerate llms.txt with `rdk fix` and commit it together with the docs change';
}

/** Resolves the npm package name from the arguments or the repository itself. */
function packageNameFor(args, cwd) {
  if (typeof args.package_name === 'string' && args.package_name.trim() !== '') return args.package_name.trim();
  const resolved = resolvePackage(cwd);
  return (resolved.pkg && resolved.pkg.name) || null;
}

export const TOOLS = [
  {
    name: 'npm_get_search_score',
    title: 'npm search score',
    description:
      'Get the current npms.io search score for an npm package (final, quality, popularity, maintenance) plus the concrete gaps that block the completeness bonus. Omit package_name to score the package in the current repository.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        package_name: { type: 'string', description: 'npm package name; defaults to the publishable package in cwd.' },
        cwd: { type: 'string', description: 'Repository directory to inspect when package_name is omitted.' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const name = packageNameFor(args, cwd);
      if (!name) return { ok: false, error: 'no package name given and none found in the repository' };

      const response = await httpGet(`https://api.npms.io/v2/package/${encodeURIComponent(name)}`);
      if (!response.ok || response.text === '') {
        // Fall back to the npm registry: not the same score, but the same
        // completeness signals, and it keeps working behind egress filters.
        // The abbreviated /latest document keeps the response small enough to
        // parse reliably even with a byte cap in place.
        const encoded = name.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        const registry = await httpGet(`https://registry.npmjs.org/${encoded}/latest`, { maxBytes: 1024 * 1024 });
        if (registry.status === 404) {
          return {
            ok: false,
            package: name,
            error: 'not published on the npm registry yet (404)',
            hint: 'the CLI audit measures the local metadata; publish and re-run to compare',
          };
        }
        if (!registry.ok || registry.text === '') {
          return {
            ok: false,
            package: name,
            error: 'neither npms.io nor the npm registry is reachable from this environment',
            hint: 'the CLI audit still measures local metadata offline',
          };
        }
        let metadata;
        try {
          const doc = JSON.parse(registry.text);
          // The registry answers either with the abbreviated /latest manifest or
          // with a full packument; support both.
          const latestTag = doc['dist-tags'] && doc['dist-tags'].latest;
          metadata = (latestTag && doc.versions && doc.versions[latestTag]) || doc;
        } catch {
          return { ok: false, package: name, error: 'could not parse the npm registry response' };
        }
        const gaps = [];
        if (!metadata.version || metadata.version.startsWith('0.')) gaps.push(`version ${metadata.version || 'unknown'} is pre-1.0.0`);
        if (metadata.deprecated) gaps.push('the package is marked deprecated');
        if (!Array.isArray(metadata.keywords) || metadata.keywords.length === 0) gaps.push('no keywords in package.json');
        if (!metadata.description) gaps.push('no description in package.json');
        if (!metadata.readme) gaps.push('no README in the published tarball');
        if (!metadata.scripts || !metadata.scripts.test) gaps.push('no test script visible in the published manifest');
        return {
          ok: true,
          package: name,
          source: 'registry.npmjs.org (npms.io unreachable, completeness signals only)',
          scores: null,
          latest_version: metadata.version || null,
          deprecated: Boolean(metadata.deprecated),
          gaps,
        };
      }
      let analyzed;
      try {
        analyzed = JSON.parse(response.text).analyzed;
      } catch {
        return { ok: false, package: name, error: 'could not parse the npms.io response' };
      }
      if (!analyzed || !analyzed.score) {
        return { ok: false, package: name, error: 'npms.io returned no score for this package' };
      }

      const score = analyzed.score;
      const result = {
        ok: true,
        package: name,
        source: 'api.npms.io',
        final: score.final,
        quality: score.quality,
        popularity: score.popularity,
        maintenance: score.maintenance,
        detail: score.detail || null,
        gaps: [],
      };
      const metadata = analyzed.metadata || {};
      const github = analyzed.github || {};
      if (!metadata.version || metadata.version.startsWith('0.')) {
        result.gaps.push(`version ${metadata.version || '?'} is pre-1.0.0 — the completeness bonus needs >= 1.0.0`);
      }
      if (metadata.deprecated) result.gaps.push('the package is marked deprecated');
      if (typeof github.issues?.openCount === 'number' && github.issues.openCount >= 15) {
        result.gaps.push(`${github.issues.openCount} open issues — the bonus needs < 15`);
      }
      if (!metadata.hasReadme) result.gaps.push('no README in the published tarball');
      if (!analyzed.evaluation || !analyzed.evaluation.quality?.hasTests) result.gaps.push('no tests detected');
      await record(`npm:${name}`, { final: score.final, quality: score.quality, popularity: score.popularity, maintenance: score.maintenance }, cwd);
      result.trend = trend(`npm:${name}`, cwd);
      return result;
    },
  },

  {
    name: 'github_audit_visibility_signals',
    title: 'GitHub visibility signals',
    description:
      'Audit the live GitHub visibility signals of a repository: stars, forks, topics, open issues, release freshness, wiki and discussions, with the same thresholds the CLI audit uses.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name; defaults to the origin remote of cwd.' },
        cwd: { type: 'string', description: 'Repository directory used to resolve the default repo.' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const { git } = loadConfig(cwd);
      const repo = args.repo || (git.host === 'github.com' && git.owner && git.repo ? `${git.owner}/${git.repo}` : null);
      if (!repo) return { ok: false, error: 'no repository resolved (pass repo=owner/name)' };

      const result = ghFor(context)(
        [
          'repo',
          'view',
          repo,
          '--json',
          [
            'nameWithOwner',
            'description',
            'homepageUrl',
            'stargazerCount',
            'forkCount',
            'watchers',
            'issues',
            'pullRequests',
            'repositoryTopics',
            'pushedAt',
            'updatedAt',
            'createdAt',
            'hasWikiEnabled',
            'hasDiscussionsEnabled',
            'isArchived',
            'isFork',
            'licenseInfo',
            'defaultBranchRef',
            'latestRelease',
            'securityPolicyUrl',
          ].join(','),
        ],
        { cwd },
      );
      if (!result.ok) {
        return { ok: false, repo, error: 'the gh CLI is unavailable or not authenticated', detail: result.stderr.slice(0, 200) };
      }
      let data;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        return { ok: false, repo, error: 'could not parse the gh response' };
      }

      const topics = (data.repositoryTopics || []).map((topic) => (topic && topic.name) || String(topic));
      const openIssues = data.issues && typeof data.issues.totalCount === 'number' ? data.issues.totalCount : null;
      const openPullRequests = data.pullRequests && typeof data.pullRequests.totalCount === 'number' ? data.pullRequests.totalCount : null;
      const lastPush = data.pushedAt ? Date.parse(data.pushedAt) : null;
      const daysSincePush = lastPush ? Math.round((Date.now() - lastPush) / 86400000) : null;
      const lastRelease = data.latestRelease && data.latestRelease.publishedAt ? Date.parse(data.latestRelease.publishedAt) : null;
      const daysSinceRelease = lastRelease ? Math.round((Date.now() - lastRelease) / 86400000) : null;

      const signals = {
        ok: true,
        repo: data.nameWithOwner || repo,
        description: data.description || null,
        homepage: data.homepageUrl || null,
        stars: data.stargazerCount ?? null,
        forks: data.forkCount ?? null,
        watchers: (data.watchers && data.watchers.totalCount) ?? null,
        open_issues: openIssues,
        open_pull_requests: openPullRequests,
        topics,
        topic_count: topics.length,
        has_wiki: Boolean(data.hasWikiEnabled),
        has_discussions: Boolean(data.hasDiscussionsEnabled),
        has_security_policy: Boolean(data.securityPolicyUrl),
        archived: Boolean(data.isArchived),
        fork: Boolean(data.isFork),
        license: (data.licenseInfo && data.licenseInfo.spdxId) || null,
        default_branch: (data.defaultBranchRef && data.defaultBranchRef.name) || null,
        days_since_last_push: daysSincePush,
        days_since_last_release: daysSinceRelease,
        created_at: data.createdAt || null,
        findings: [],
      };
      if (!data.description) signals.findings.push({ id: 'github.description', severity: 'error', fix: 'set a 1-2 sentence repository description' });
      if (topics.length < 8) signals.findings.push({ id: 'github.topics_count', severity: topics.length === 0 ? 'error' : 'warn', fix: `add ${Math.max(0, 8 - topics.length)} more topics (target 8-20)` });
      if (topics.length > 20) signals.findings.push({ id: 'github.topics_count', severity: 'warn', fix: 'drop the weakest topics' });
      if (!data.homepageUrl) signals.findings.push({ id: 'github.homepage', severity: 'warn', fix: 'set a homepage URL' });
      if (daysSincePush !== null && daysSincePush > 90) signals.findings.push({ id: 'github.freshness', severity: 'warn', fix: `no pushes for ${daysSincePush} days — stale projects lose recommendations` });
      if (openIssues !== null && openIssues >= 15) signals.findings.push({ id: 'github.issues', severity: 'warn', fix: `${openIssues} open issues blocks the npms.io completeness bonus` });
      if (data.isArchived) signals.findings.push({ id: 'github.archived', severity: 'error', fix: 'the repository is archived' });

      await record(`github:${signals.repo}`, { stars: signals.stars, forks: signals.forks, topics: signals.topic_count, open_issues: openIssues }, cwd);
      signals.history_points = series(`github:${signals.repo}`, 10, cwd).length;
      signals.trend = {
        stars: trend(`github:${signals.repo}`, cwd),
      };
      return signals;
    },
  },

  {
    name: 'llms_txt_check_freshness',
    title: 'llms.txt freshness',
    description:
      'Check whether llms.txt still matches its sources: marker-managed files are compared against the rendered output, hand-written files against source modification times; drift is reported because a stale llms.txt actively misleads agents.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory to inspect.' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const { config, publishable } = loadConfig(cwd);
      const fresh = llmsFreshness(cwd, config, publishable.pkg);
      if (!fresh.exists) {
        return { ok: false, cwd, error: 'llms.txt not found', fix: 'run `rdk fix` to generate it' };
      }
      const driftHours = fresh.driftMs === null ? null : Math.round(fresh.driftMs / 3600000);
      const driftMinutes = fresh.driftMs === null ? null : Math.round(fresh.driftMs / 60000);
      return {
        ok: true,
        cwd,
        managed: fresh.managed,
        llms_txt_modified: fresh.modified !== null ? new Date(fresh.modified).toISOString() : null,
        sources_checked: fresh.sources,
        newer_sources: fresh.newerSources.map((source) => (source.contentDrift
          ? { path: source.path, content_drift: true }
          : { path: source.path, hours_newer: Math.round((source.mtime - fresh.modified) / 3600000) })),
        drift_hours: driftHours,
        drift_minutes: driftMinutes,
        fresh: fresh.fresh,
        recommendation: fresh.fresh
          ? 'llms.txt is up to date'
          : fresh.managed
            ? 'llms.txt no longer matches the rendered output - regenerate with `rdk fix`'
            : driftMsRecommendation(fresh.driftMs),
      };
    },
  },

  {
    name: 'site_check_llms_txt',
    title: 'Site llms.txt probe',
    description:
      'Check that a project website serves /llms.txt at its domain root and report status, size and the first heading so an agent can decide whether to fetch it.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site root (https://example.com) or a full llms.txt URL. Defaults to links.homepage or links.docs from the project config.' },
        url: { type: 'string', description: 'Alias for site.' },
        cwd: { type: 'string', description: 'Repository directory used to resolve the default URL.' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      let target = typeof args.site === 'string' && args.site !== '' ? args.site : null;
      if (!target && typeof args.url === 'string' && args.url !== '') target = args.url;
      if (!target) {
        const { config } = loadConfig(cwd);
        target = (config.links && (config.links.homepage || config.links.docs)) || null;
      }
      if (!target) return { ok: false, error: 'no URL given and links.homepage/links.docs are not configured' };

      // Drop any fragment or query string before appending the path.
      const clean = target.replace(/[?#].*$/, '').replace(/\/+$/, '');
      const url = /llms\.txt$/i.test(clean) ? clean : `${clean}/llms.txt`;
      const response = await httpGet(url);
      if (!response.ok) {
        return {
          ok: false,
          url,
          status: response.status ?? null,
          present: false,
          bytes: 0,
          first_heading: null,
          findings: [
            {
              id: 'docs.llms_txt',
              severity: 'error',
              fix: response.error || `serve a valid llms.txt at ${url} (HTTP ${response.status})`,
            },
          ],
          error: response.error || `HTTP ${response.status}`,
        };
      }
      const firstHeading = firstHeadingOf(response.text);
      return {
        ok: true,
        url,
        status: response.status,
        present: true,
        bytes: Buffer.byteLength(response.text, 'utf8'),
        first_heading: firstHeading,
        via: response.via,
        hint: response.bytes < 200 ? 'the file is suspiciously small — check that it lists real documentation links' : null,
      };
    },
  },

  {
    name: 'repo_get_discoverability_score',
    title: 'Discoverability score',
    description:
      'Run the same discoverability audit engine as the CLI against a repository and return the full 0-100 score, per-axis breakdown and every finding.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory to audit.' },
        online: { type: 'boolean', description: 'Probe outbound links and read live GitHub metadata (default false).' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const report = await cachedAudit(cwd, Boolean(args.online));
      await record('discoverability_score', report.score.total, cwd);
      const trendData = trend('discoverability_score', cwd);
      return { ok: true, ...report, history_points: trendData.points, trend: trendData };
    },
  },

  {
    name: 'repo_list_findings',
    title: 'Findings list',
    description:
      'List the audit findings for a repository, filtered by severity, effort or autofixability, so an agent can work through them one at a time.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory to audit.' },
        severity: { type: 'string', enum: ['error', 'warn', 'info'], description: 'Only return findings of this severity.' },
        axis: { type: 'string', description: 'Only return findings for this axis.' },
        autofixable_only: { type: 'boolean', description: 'Only return findings that `rdk fix` can apply.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Maximum number of findings to return.' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Number of findings to skip.' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const report = await cachedAudit(cwd, false);
      let findings = report.findings;
      if (args.severity) findings = findings.filter((finding) => finding.severity === args.severity);
      if (args.axis) findings = findings.filter((finding) => finding.axis === args.axis);
      if (args.autofixable_only) findings = findings.filter((finding) => finding.autoFixable);
      const offset = Number(args.offset) || 0;
      const limit = Number(args.limit) || 20;
      return {
        ok: true,
        total: findings.length,
        returned: Math.max(0, Math.min(limit, findings.length - offset)),
        score: report.score.total,
        grade: report.score.grade,
        findings: findings.slice(offset, offset + limit).map((finding) => ({
          id: finding.id,
          axis: finding.axis,
          severity: finding.severity,
          title: finding.title,
          why: finding.why,
          fix: finding.fix,
          effort: finding.effort,
          autoFixable: finding.autoFixable,
          weight: finding.weight,
        })),
      };
    },
  },

  {
    name: 'competitor_scan_list_articles',
    title: 'Listicle mention scan',
    description:
      'Scan a configured search endpoint for "top N tools" list articles in the project niche and report which competitors are mentioned, because appearing in those lists is how chat assistants pick recommendations.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "best cli tools for npm metadata".' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Maximum number of articles to return.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async run(args) {
      const endpoint = process.env.RDK_SEARCH_ENDPOINT;
      if (!endpoint) {
        return {
          ok: false,
          available: false,
          error: 'RDK_SEARCH_ENDPOINT is not configured',
          hint: 'set RDK_SEARCH_ENDPOINT to a JSON search API that accepts ?q= and returns { results: [{ title, url, snippet }] }',
        };
      }
      const query = typeof args.query === 'string' && args.query !== '' ? args.query : null;
      if (!query) return { ok: false, error: 'query is required' };
      const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`;
      const response = await httpGet(url);
      if (!response.ok) return { ok: false, error: `search endpoint returned HTTP ${response.status}` };
      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        return { ok: false, error: 'could not parse the search endpoint response' };
      }
      const results = Array.isArray(payload.results) ? payload.results : [];
      const limit = Number(args.limit) || 10;
      return {
        ok: true,
        query,
        articles: results.slice(0, limit).map((item) => ({ title: item.title || null, url: item.url || null, snippet: item.snippet || null })),
        note: 'presence in high-ranking list articles is a proxy for chat-assistant recommendations, not a guarantee',
      };
    },
  },

  {
    name: 'distribution_check_submissions',
    title: 'Distribution campaign status',
    description:
      'Report the canonical distribution campaign status built from .discoverability/submissions.json: per-item channel, target, live PR state, live presence (listed/unlisted) for crawl- and registry-style channels, attention and the next command to run, plus a summary by attention. live: true probes git-pr entries through the gh CLI and verifies non-PR channels for live presence; include_recommendations: true adds which channels apply to this repository; adopt: true and sync: true return read-only previews with a plan_digest and never write the ledger.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory holding .discoverability/submissions.json.' },
        live: { type: 'boolean', default: false, description: 'Probe live state: git-pr submissions via gh, crawl- and registry-style channels via their presence checks (default false: report the recorded state).' },
        include_recommendations: { type: 'boolean', default: false, description: 'Also recommend distribution channels: which apply to this repository, their campaign status and the next action (default false).' },
        adopt: { type: 'boolean', default: false, description: 'Preview adopting unrecorded rdk/* pull requests into the ledger; read-only, never writes (default false).' },
        sync: { type: 'boolean', default: false, description: 'Preview syncing recorded statuses with live PR states and presence checks; read-only, never writes (default false).' },
      },
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const ledger = readLedger(cwd);
      if (ledger === null) {
        return { ok: false, cwd, error: 'could not parse .discoverability/submissions.json', fix: 'the file is committed campaign state - fix it by hand or restore it from git' };
      }
      if (args.adopt === true && args.sync === true) {
        return { ok: false, cwd, error: 'pass either adopt or sync, not both' };
      }
      const status = await buildDistributionStatus({
        cwd,
        live: args.live === true,
        gh: ghFor(context),
        fetchImpl: fetchFor(context),
        now: () => new Date().toISOString(),
      });
      if (args.adopt === true) {
        const targets = [...new Set(ledger.map((row) => row && row.target).filter((target) => typeof target === 'string' && target !== ''))];
        const rows = adoptRows(ledger, matchAdoptable(discoverOwnedPrs({ gh: ghFor(context), cwd, targets })));
        return { ok: true, status, preview: rows, plan_digest: planDigest(rows) };
      }
      if (args.sync === true) {
        const hydratedByKey = {};
        for (const row of ledger) {
          const hydrated = await hydrateByProbe({ entry: row, channel: channelById(row.channel), gh: ghFor(context), fetchImpl: fetchFor(context), cwd });
          if (hydrated && hydrated.ok && hydrated.normalized) hydratedByKey[row.dedupe_key || row.pr_url] = hydrated.normalized;
        }
        const { changes } = applySync(ledger, hydratedByKey, { at: new Date().toISOString() });
        return { ok: true, status, preview: changes, plan_digest: planDigest(changes) };
      }
      const payload = { ok: true, ...status };
      if (args.include_recommendations === true) payload.recommendations = recommend(cwd, loadConfig(cwd));
      return payload;
    },
  },

  {
    name: 'github_sync_metadata',
    title: 'Sync metadata to GitHub',
    description:
      'Write the description, homepage and topics from .discoverability/project.yml to GitHub. This is the only write tool: it requires the acknowledgement string and a reason (both logged to the local history), and apply additionally requires either an accepted elicitation confirmation from the user or the plan_digest of a preview.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ack: { type: 'string', description: 'Must equal the acknowledgement string configured for this repository (safety.ack in .discoverability/project.yml); when unset, the server-configured default documented in the package README applies.' },
        reason: { type: 'string', description: 'Why this repository write is correct; stored in the local history.' },
        repo: { type: 'string', description: 'owner/name; defaults to the origin remote of cwd.' },
        cwd: { type: 'string', description: 'Repository directory holding the config.' },
        fields: {
          type: 'array',
          items: { type: 'string', enum: ['topics', 'description', 'homepage'] },
          description: 'Which fields to sync (default: all that differ).',
        },
        apply: {
          type: 'boolean',
          default: false,
          description: 'False (default) returns the planned mutations without touching GitHub. Set true only after reviewing the plan; requires the plan_digest from the preview.',
        },
        plan_digest: {
          type: 'string',
          description: 'The plan_digest value from a preview response. Required when apply is true; the write is refused when it does not match the current plan.',
        },
      },
      required: ['ack', 'reason'],
      additionalProperties: false,
    },
    async run(args, context = {}) {
      const cwd = resolveCwd(args, context);
      const { config } = loadConfig(cwd);
      if (String(args.ack || '') !== effectiveAck(config)) {
        return {
          ok: false,
          error:
            'refusing to write: ack must equal the acknowledgement string configured for this repository (safety.ack in .discoverability/project.yml; the default is documented in the package README)',
        };
      }
      if (typeof args.reason !== 'string' || args.reason.trim().length < 5) {
        return { ok: false, error: 'refusing to write: a non-trivial reason is required and is logged' };
      }
      // Preview first: an agent must opt in to the write, exactly like `rdk fix`.
      const apply = args.apply === true;
      const preview = await githubSyncCommand({
        cwd,
        options: { apply: false, ack: args.ack, reason: args.reason, repo: args.repo, fields: args.fields },
        config,
      });
      if (!apply) {
        return {
          ok: preview.ok !== false,
          applied: false,
          dry_run: true,
          mutations: [],
          mutation_count: 0,
          plan: Array.isArray(preview.plan) ? preview.plan : [],
          plan_digest: typeof preview.plan_digest === 'string' ? preview.plan_digest : null,
          repo: args.repo || null,
          reason: args.reason,
          code: preview.code || null,
          error: preview.error || null,
          output: preview.output,
          history: series('github_sync', 5, cwd),
        };
      }
      let digest = typeof args.plan_digest === 'string' ? args.plan_digest : null;
      const canElicit = typeof context.request === 'function' && Boolean(context.clientCapabilities && context.clientCapabilities.elicitation);
      if (canElicit) {
        let elicitation;
        try {
          elicitation = await context.request('elicitation/create', {
            mode: 'form',
            message: `Approve GitHub metadata sync for ${args.repo || 'the resolved repository'} (plan digest ${preview.plan_digest}): ${JSON.stringify(preview.plan || [])}`,
            requestedSchema: {
              type: 'object',
              properties: { approve: { type: 'boolean', description: 'Approve this exact plan' } },
              required: ['approve'],
              additionalProperties: false,
            },
          });
        } catch (error) {
          return { ok: false, code: 'elicitation_failed', error: `refusing to write: elicitation failed: ${error.message}` };
        }
        if (!elicitation || elicitation.action !== 'accept' || !(elicitation.content && elicitation.content.approve === true)) {
          return { ok: false, code: 'elicitation_declined', error: 'refusing to write: the confirmation request was declined or cancelled' };
        }
        digest = typeof preview.plan_digest === 'string' ? preview.plan_digest : digest;
      }
      if (!digest) {
        return {
          ok: false,
          code: 'plan_digest_required',
          error: 'refusing to write: apply requires the plan_digest from the preview response - run with apply: false first, then pass its plan_digest with the apply call',
        };
      }
      const result = await githubSyncCommand({
        cwd,
        options: { apply: true, ack: args.ack, reason: args.reason, repo: args.repo, fields: args.fields, plan_digest: digest },
        config,
      });
      const mutations = Array.isArray(result.applied) ? result.applied : [];
      await record('github_sync', { applied: mutations, reason: args.reason, apply }, cwd);
      // The command explains itself in `output`; surface the same text as
      // `error` so an agent never receives a refusal it cannot act on.
      const error = result.error || (result.ok === false ? firstReasonLine(result.output) : null);
      return {
        ok: result.ok !== false,
        applied: apply && mutations.length > 0,
        dry_run: !apply,
        mutations,
        mutation_count: mutations.length,
        plan: Array.isArray(result.plan) ? result.plan : [],
        plan_digest: typeof result.plan_digest === 'string' ? result.plan_digest : null,
        repo: args.repo || null,
        reason: args.reason,
        code: result.code || null,
        error,
        output: result.output,
        history: series('github_sync', 5, cwd),
      };
    },
  },
];

export function findTool(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
}

/**
 * Runs a tool by name and always resolves with a payload (never throws).
 * Shared by the MCP server and the CLI so both surfaces stay in sync.
 * In read-only mode the write tool is indistinguishable from an unknown tool.
 */
export async function callTool(name, args = {}, context = {}) {
  const tool = findTool(name);
  if (!tool) return { ok: false, error: `unknown tool: ${String(name)}` };
  if (context.readOnly === true && tool.annotations && tool.annotations.readOnlyHint === false) {
    return { ok: false, error: `unknown tool: ${String(name)}` };
  }
  try {
    return await tool.run(args || {}, context);
  } catch (error) {
    return { ok: false, tool: name, error: String((error && error.message) || error) };
  }
}

/** Public tool descriptors (what MCP clients see in tools/list). */
export function toolDescriptors(options = {}) {
  const readOnly = options && options.readOnly === true;
  return TOOLS.filter((tool) => !(readOnly && tool.annotations && tool.annotations.readOnlyHint === false)).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}
