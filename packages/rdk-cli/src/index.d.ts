/**
 * Type definitions for the programmatic API of repo-aeo.
 * The package itself is plain ESM JavaScript; these declarations describe the
 * shapes returned by `audit()` and consumed by the report renderers.
 */

export type Severity = 'error' | 'warn' | 'info';
export type Effort = 'S' | 'M' | 'L';
export type Axis = 'github' | 'readme' | 'agents' | 'npm' | 'docs' | 'hygiene';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface Finding {
  id: string;
  axis: Axis;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  effort: Effort;
  autoFixable: boolean;
  patchId: string | null;
  weight: number;
}

export interface AxisScore {
  label: string;
  hint: string;
  score: number;
  weight: number;
  applicable: boolean;
  passed: number;
  total: number;
}

export interface DiscoverabilityScore {
  total: number;
  grade: Grade;
  axes: Record<Axis, AxisScore>;
}

export interface AuditSummary {
  errors: number;
  warnings: number;
  info: number;
  autofixable: number;
  checks: number;
  passedChecks: number;
}

export interface AuditEnvironment {
  offline: boolean;
  github_source: string;
  links_checked: number;
  has_npm_package: boolean;
  has_docs_site: boolean;
  npm_package_path: string | null;
}

export interface AuditOptions {
  /** Probe outbound links and read live GitHub metadata. */
  online?: boolean;
  /** Number of recent commits scanned by the secrets heuristic (default 20). */
  secretsDepth?: number;
  /** Read live GitHub metadata with the gh CLI (default: true when online). */
  github?: boolean;
  /** Per-link timeout in milliseconds (default 6000). */
  linkTimeout?: number;
}

export interface AuditReport {
  schema: 'rdk-audit/1';
  tool: string;
  generated_at: string;
  duration_ms: number;
  project: {
    name: string | null;
    /** Web URL of the audited repository, derived from its origin remote. */
    repo_url?: string;
    category: string;
    version: string | null;
    config_path: string | null;
  };
  environment: AuditEnvironment;
  score: DiscoverabilityScore;
  summary: AuditSummary;
  findings: Finding[];
  next_actions: Array<{ id: string; severity: Severity; fix: string; effort: Effort }>;
  config_warnings: Array<{ code: string; message: string }>;
}

/** Runs the full discoverability audit. Read-only, offline by default. */
export declare function audit(cwd?: string, options?: AuditOptions): Promise<AuditReport>;

export interface FileMutation {
  path: string;
  before: string | null;
  after: string;
  created: boolean;
}

export interface PlannedPatch {
  id: string;
  title: string;
  description: string;
  risk: 'safe' | 'needs-review';
  compute(): FileMutation[];
}

/** Returns the patches that would change something right now. */
export declare function planPatches(
  ctx: unknown,
  options?: { only?: string[] | null; skip?: string[]; checkMutations?: boolean },
): PlannedPatch[];

/** Applies planned mutations to disk and returns the written paths. */
export declare function applyPatches(planned: PlannedPatch[]): string[];

export declare const PATCHES: Array<{
  id: string;
  title: string;
  description: string;
  risk: 'safe' | 'needs-review';
}>;

export declare function renderMarkdownReport(report: AuditReport): string;
export declare function renderGithubComment(report: AuditReport, options?: { maxFindings?: number }): string;
export declare const COMMENT_MARKER: string;

export declare const AXIS_WEIGHTS: Record<Axis, number>;
export declare const AXIS_LABELS: Record<Axis, string>;
/** Canonical home of this tool; used for report footers and user agents. */
export declare const TOOL_HOME: string;

/** Owner used when the audited repository has no origin remote to read. */
export declare const DEFAULT_OWNER: string;

/** Web URL of the audited repository, derived from its origin remote. */
export declare function repoWebUrl(cwd?: string): string;

/** Owner (user or organisation) of the audited repository. */
export declare function repoOwner(cwd?: string): string;

/** Documentation URL for a file in this tool's repository. */
export declare function toolDocUrl(path?: string, ref?: string): string;

export declare function grade(total: number): Grade;

export interface RdkConfig {
  schema_version: number;
  project: {
    name: string | null;
    one_liner: string | null;
    description: string | null;
    category: string;
    copyright_holder: string | null;
  };
  audiences: string[];
  use_cases: string[];
  keywords: { github_topics: string[]; npm_keywords: string[] };
  links: { homepage: string | null; docs: string | null; demo: string | null; issues: string | null };
  quickstart: { prerequisites: string[]; install: string | null; run: string | null; test: string | null };
  artifacts: { has_npm_package: boolean; has_docs_site: boolean };
  differentiators: string[];
  safety: {
    allow_autofix: boolean;
    require_ack_for_publish: boolean;
    /** Non-empty string overrides the github-sync ACK constant; null keeps the default. */
    ack: string | null;
  };
}

export declare function loadConfig(cwd?: string): {
  config: RdkConfig;
  configPath: string;
  exists: boolean;
  warnings: Array<{ code: string; message: string }>;
  pkg: Record<string, unknown> | null;
  publishable: {
    pkg: Record<string, unknown> | null;
    path: string | null;
    isPrivate: boolean;
    source: string;
  };
  git: Record<string, unknown>;
};

export declare function buildSeedConfig(cwd?: string): RdkConfig;
export declare const CONFIG_RELATIVE_PATH: string;
export declare function parseYaml(text: string): unknown;

export declare function computeScore(
  perAxis: Record<string, { passed: number; total: number }>,
  applicableAxes: string[],
): DiscoverabilityScore;

export declare function resolvePackage(cwd?: string): {
  pkg: Record<string, unknown> | null;
  path: string | null;
  isPrivate: boolean;
  source: string;
};

export declare const DEFAULT_ACK: string;
export declare function resolveRepo(cwd?: string, options?: { repo?: string }): string | null;
export declare function effectiveAck(config: RdkConfig): string;
export declare function planDigest(plan: unknown[]): string;

export interface GithubSyncResult {
  ok: boolean;
  output: string;
  error?: string | null;
  code?: string | null;
  exitCode: number;
  applied: string[];
  plan?: Array<{ field: string; from: unknown; to: unknown }>;
  plan_digest?: string | null;
}

export declare function githubSyncCommand(args: {
  cwd: string;
  options: Record<string, unknown>;
  config: RdkConfig;
  ghRunner?: (args: string[], options: { cwd: string }) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}): Promise<GithubSyncResult>;

export interface Submission {
  target: string;
  pr_url?: string;
  branch?: string;
  fork?: string;
  submitted_at?: string;
  status?: string;
  channel?: string;
  mechanism?: string;
  artifact?: string;
  dedupe_key?: string;
}

export interface SubmitResult {
  ok: boolean;
  output: string;
  error?: string | null;
  code?: string | null;
  exitCode?: number;
  applied: Submission[];
  plan?: unknown[];
  plan_digest?: string | null;
}

export declare function submissionsPath(cwd?: string): string;
/** Reads the campaign ledger; null means present but unparsable. */
export declare function readSubmissions(cwd?: string): Submission[] | null;
export declare function buildEntry(args: { name: string; url: string; oneLiner?: string | null; entry?: string }): string;
export declare function insertEntryIntoReadme(
  readme: string,
  category: string,
  entry: string,
  position?: 'end' | 'alphabetical',
): { ok: boolean; readme?: string; error?: string };
export declare function submitCommand(args: {
  cwd: string;
  options: Record<string, unknown>;
  config: RdkConfig;
  /** The full loadConfig() result; loaded.publishable.pkg feeds the http-json and cli-publish plans, falling back to loaded.pkg. */
  loaded?: ReturnType<typeof loadConfig> | null;
  ghRunner?: (args: string[]) => { ok: boolean; stdout?: string; stderr?: string };
  gitRunner?: (args: string[], options?: { timeout?: number }) => { ok: boolean; stdout?: string; stderr?: string };
  fetchImpl?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>;
}): Promise<SubmitResult>;

export interface GuardResult {
  ok: boolean;
  code?: 'ack_mismatch' | 'reason_required' | 'plan_digest_required' | 'plan_digest_mismatch';
  error?: string;
}

/**
 * Enforces the write-guard chain in order: ack -> reason (>= 5 chars) ->
 * plan_digest present -> digest match. Guards apply only when
 * options.apply is set; the digest match runs only when a plan is passed.
 */
export declare function assertWriteGuards(args: {
  options: Record<string, unknown>;
  config: RdkConfig;
  plan?: unknown[];
}): GuardResult;

export interface ChannelDescriptor {
  id: string;
  mechanism: string;
  artifact: string;
  accepts: string[];
  summary: string;
  /** Named predicate evaluated against the artifact inventory by applicableChannels. */
  when: string;
  automatable: boolean;
  probe: string;
  endpoint?: string;
  method?: string;
  auth?: { env: string };
  dedupe?: { url: string };
  formUrl?: string;
  fields?: string[];
  checkUrl?: string;
}

export declare const CHANNELS: ChannelDescriptor[];
export declare const CHANNEL_DESCRIPTOR_FIELDS: readonly string[];
export declare function channelById(id: string): ChannelDescriptor | null;
export declare function applicableChannels(inventory: ArtifactInventory): ChannelDescriptor[];

export declare function readLedger(cwd?: string): Submission[] | null;
/** Appends rows and returns the written ledger; null means the existing ledger is unparsable and was left untouched. */
export declare function appendRecords(cwd: string, rows: Submission[]): Submission[] | null;
/** True while a submission is in flight or already landed; terminal negatives allow one retry. */
export declare function isBlocking(record: Submission): boolean;
/**
 * Projects a record's status through a live probe result. probeResult carries
 * the PR state ('open' | 'merged' | 'closed'); null keeps the recorded status.
 */
export declare function projectStatus(record: Submission, probeResult: { state: string } | null): string | null;

export declare function writeLedger(cwd: string, rows: Submission[]): Submission[] | null;
export declare function upsertRecords(cwd: string, rows: Submission[]): Submission[] | null;
export declare function syncTransition(hydrated: NormalizedPr): string | null;
export declare function applySync(
  rows: Submission[],
  hydratedByKey: Record<string, NormalizedPr>,
  args: { at: string },
): { rows: Submission[]; changes: Array<{ key: string; from: string; to: string }> };

export type AttentionState = 'action_required' | 'awaiting_review' | 'approved' | 'stale' | 'none' | 'listed' | 'terminal';

export interface DistributionItem {
  channel: string | null;
  target: string | null;
  pr_url: string | null;
  state: string | null;
  is_draft: boolean | null;
  review_decision: string | null;
  merge_state: string | null;
  checks: { pass: number; fail: number; pending: number };
  attention: AttentionState;
  needed: string[];
  why: string;
  action: string;
  command: string;
}

export interface DistributionStatus {
  schema_version: string;
  generated_at: string;
  summary: { total: number; by_attention: Record<string, number>; by_state: Record<string, number> };
  items: DistributionItem[];
}

export declare const DISTRIBUTION_SCHEMA: string;
export declare function buildDistributionStatus(args: {
  cwd: string;
  loaded?: ReturnType<typeof loadConfig> | null;
  options?: Record<string, unknown>;
  gh?: (args: string[], opts?: { cwd?: string }) => { ok: boolean; stdout?: string; stderr?: string };
  git?: (args: string[], options?: { timeout?: number }) => { ok: boolean; stdout?: string; stderr?: string };
  fetchImpl?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>;
  now?: () => string;
  live?: boolean;
}): DistributionStatus;
export declare function renderDistributionStatus(status: DistributionStatus): string;

export interface NormalizedPr {
  state: string | null;
  is_draft: boolean;
  review_decision: string | null;
  merge_state: string | null;
  merged: boolean;
  checks: { pass: number; fail: number; pending: number };
  reviews: Array<{ state: unknown; authorAssociation: unknown }>;
  comments: Array<{ createdAt: unknown; authorAssociation: unknown; body: string }>;
  last_push: string | null;
  updatedAt: string | null;
  close_reason: string | null;
  url: string | null;
}

export declare function normalizeGhPrView(raw: Record<string, unknown>): NormalizedPr;
export declare function hydrateGitPr(args: {
  entry: Submission;
  gh: (args: string[], opts?: { cwd?: string }) => { ok: boolean; stdout?: string; stderr?: string };
  cwd: string;
}): { ok: boolean; normalized?: NormalizedPr; raw?: unknown; error?: string };
export declare function hydrateByProbe(args: {
  probe: { kind: string | null; ref: string | null };
  entry: Submission;
  gh?: (args: string[], opts?: { cwd?: string }) => { ok: boolean; stdout?: string; stderr?: string };
  cwd?: string;
}): { ok: boolean; normalized?: NormalizedPr; raw?: unknown; error?: string; recorded?: boolean; kind?: string };

export declare function evaluateAttention(
  hydrated: NormalizedPr | null,
  entry: Submission | null,
  ctx: { hasLive?: boolean; now?: string; staleDays?: number },
): AttentionState;
export declare function neededFor(attention: AttentionState, hydrated: NormalizedPr | null): string[];
export declare function commandFor(
  item: { channel?: string | null; target?: string | null; pr_url?: string | null; attention?: string; fork?: string },
  ctx: Record<string, unknown>,
): string;
export declare function countChecks(rollup: unknown): { pass: number; fail: number; pending: number };
export declare function isMaintainer(association: unknown): boolean;

export interface TrackingCache {
  schema_version: string;
  snapshots: Record<string, Record<string, unknown>>;
}

export declare function trackingCachePath(cwd?: string): string;
export declare function readTrackingCache(cwd?: string): TrackingCache;
export declare function writeTrackingCache(cwd: string, cache: TrackingCache): string;
export declare function snapshotKey(entry: Submission): string;

export interface OwnedPr {
  url: string;
  target: string;
  number: number | null;
  state: string | null;
  isDraft: boolean;
  headRefName?: string;
}

export interface AdoptablePr {
  url: string;
  target: string;
  branch: string;
  number: number | null;
  state: string | null;
}

export declare function discoverOwnedPrs(args: {
  gh: (args: string[], opts?: { cwd?: string }) => { ok: boolean; stdout?: string; stderr?: string };
  cwd: string;
  targets?: string[];
}): OwnedPr[];
export declare function matchAdoptable(prs: OwnedPr[]): AdoptablePr[];
export declare function adoptRows(ledger: Submission[], adoptable: AdoptablePr[]): Submission[];
export declare function applyAdopt(cwd: string, rows: Submission[]): Submission[] | null;

export declare function trackCommand(args: {
  cwd: string;
  options?: Record<string, unknown>;
  config?: RdkConfig;
  loaded?: ReturnType<typeof loadConfig> | null;
  ghRunner?: (args: string[], opts?: { cwd?: string; timeout?: number }) => { ok: boolean; stdout?: string; stderr?: string };
  gitRunner?: (args: string[], options?: { timeout?: number }) => { ok: boolean; stdout?: string; stderr?: string };
  fetchImpl?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>;
  now?: () => string;
}): Promise<{
  ok: boolean;
  output: string;
  error?: string | null;
  code?: string | null;
  exitCode: number;
  status?: DistributionStatus;
  plan?: unknown[];
  plan_digest?: string | null;
  adopted?: Submission[];
  changes?: Array<{ key: string; from: string; to: string }>;
}>;

export interface ArtifactInventory {
  has_npm_package: boolean;
  has_docs_site: boolean;
  npm_published: boolean;
  has_mcp_server: boolean;
  has_action: boolean;
  has_skill: boolean;
  git_host: string | null;
  git_owner: string | null;
  git_repo: string | null;
}

export declare function artifactInventory(loaded: ReturnType<typeof loadConfig>): ArtifactInventory;

export interface ChannelRecommendation extends ChannelDescriptor {
  applicable: boolean;
  status: string;
  next_action: string;
}

export declare function recommend(cwd: string, loaded: ReturnType<typeof loadConfig>): {
  inventory: ArtifactInventory;
  channels: ChannelRecommendation[];
};

export declare function describeGitPr(): { id: string; summary: string };
export declare function planGitPr(ctx: {
  targets: string[];
  category: string;
  position: string;
  entry: string;
  name: string;
  url: string;
}): Array<{
  target: string;
  category: string;
  position: string;
  entry: string;
  title: string;
  branch: string;
  project: string;
  url: string;
}>;
export declare function executeGitPr(ctx: {
  item: { target: string; category: string; position: string; entry: string; title: string; branch: string; project: string; url: string };
  owner: string;
  gh: (args: string[]) => { ok: boolean; stdout?: string; stderr?: string };
  git: (args: string[], options?: { timeout?: number }) => { ok: boolean; stdout?: string; stderr?: string };
}): {
  ok: boolean;
  error?: string;
  lines: string[];
  record?: Submission;
};
/** How to probe a record's live state: the PR URL through the gh CLI. */
export declare function probeGitPr(record: Submission): { kind: string; ref: string | null };

export declare function describeHttpJson(): { id: string; summary: string };
export declare function planHttpJson(ctx: {
  targets: string[];
  channel: ChannelDescriptor | null;
  payload: unknown;
}): Array<{ target: string; endpoint: string | null; method: string; payload: unknown }>;
export declare function executeHttpJson(ctx: {
  item: { target: string; endpoint: string | null; method: string; payload: unknown };
  channel: ChannelDescriptor | null;
  fetchImpl?: (url: string, init: unknown) => Promise<Response>;
  env?: Record<string, string>;
}): Promise<{
  ok: boolean;
  error?: string;
  lines: string[];
  record?: Submission;
  checklist?: { steps: string[] };
}>;
/** How to probe a record's live state: the listing URL returned at submit time. */
export declare function probeHttpJson(record: Submission): { kind: string; ref: string | null };

export declare function describeWebForm(): { id: string; summary: string };
/** Maps the channel's form fields onto project values; unknown fields map to ''. */
export declare function buildPayload(ctx: {
  config: RdkConfig;
  url: string | null;
  channel: ChannelDescriptor | null;
}): Record<string, string>;
export declare function planWebForm(ctx: {
  channels: ChannelDescriptor[];
  config: RdkConfig;
  url: string | null;
}): Array<{ target: string | null; formUrl: string | null; payload: Record<string, string>; url: string | null }>;
export declare function executeWebForm(ctx: {
  item: { target: string | null; formUrl: string | null; payload: Record<string, string>; url: string | null };
  channel: ChannelDescriptor | null;
  cwd?: string;
  config: RdkConfig;
}): {
  ok: boolean;
  error?: string;
  lines: string[];
  record?: Submission;
  checklist?: { steps: string[]; target: string | null };
};
/** A web-form submission has no programmatic probe. */
export declare function probeWebForm(record: Submission): { kind: string; ref: null };

export declare function describePassive(): { id: string; summary: string };
export declare function planPassive(ctx: { channel?: ChannelDescriptor | null }): Array<{
  channel: string;
  precondition: string;
  requirement: string;
}>;
export declare function executePassive(ctx: {
  item?: { requirement?: string };
  channel?: ChannelDescriptor | null;
}): { ok: boolean; lines: string[]; checklist: { steps: string[] } };
/** How to probe a record's live state: the project URL to look for on the channel's index page. */
export declare function probePassive(record: Submission): { kind: string; ref: string | null };
/** Verifies presence after the fact by fetching the channel's checkUrl; resolves to 'unlisted' on any failure. */
export declare function verify(ctx: {
  record?: Submission | null;
  channel?: ChannelDescriptor | null;
  fetchImpl?: (url: string) => Promise<Response>;
}): Promise<{ status: 'listed' | 'unlisted' }>;

export declare const POLICY: { mode: 'listings-only'; runs_publish_commands: false };
export declare function describeCliPublish(): { id: string; summary: string };
export declare function planCliPublish(ctx: {
  channel?: ChannelDescriptor | null;
  config?: RdkConfig | null;
  pkg?: Record<string, unknown> | null;
}): Array<{ channel: string; package: string; version: string; artifact: string; registry_url: string }>;
export declare function buildChecklist(ctx: {
  channel?: ChannelDescriptor | null;
  config?: RdkConfig | null;
  pkg?: Record<string, unknown> | null;
}): { steps: string[] };
export declare function executeCliPublish(ctx: {
  item: { channel: string; package: string; version: string; artifact: string; registry_url: string };
  channel?: ChannelDescriptor | null;
  cwd?: string;
  config?: RdkConfig | null;
}): { ok: boolean; lines: string[]; record: Submission; checklist: { steps: string[] } };
/** How to probe a record's live state: the registry URL for the published package. */
export declare function probeCliPublish(record: Submission): { kind: string; ref: string | null };

export declare function renderServerJson(config: RdkConfig, pkg: Record<string, unknown> | null): Record<string, unknown>;
/** The value the published package must carry as mcpName. */
export declare function mcpOwnershipMarker(name: string): string;
export declare function renderClaudeMarketplace(config: RdkConfig, pkg: Record<string, unknown> | null): Record<string, unknown>;
export declare function renderCodexMarketplace(config: RdkConfig, pkg: Record<string, unknown> | null): Record<string, unknown>;

export declare function channelsCommand(args: { cwd: string; loaded: ReturnType<typeof loadConfig> }): CommandResult;

export interface CommandResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  summary?: string;
  error?: string | null;
  written?: string[];
  planned?: unknown[];
  report?: unknown;
}

export declare function auditCommand(args: { cwd: string; options?: Record<string, unknown> }): Promise<CommandResult>;
export declare function fixCommand(args: { cwd: string; options?: Record<string, unknown> }): CommandResult;
export declare function initCommand(args: { cwd: string; options?: Record<string, unknown> }): CommandResult;
export declare function npmSurfaceCommand(args: { cwd: string; options?: Record<string, unknown> }): CommandResult;

export interface SkillTarget { harness: string; dir: string; }
export declare function skillCommand(args: { cwd: string; options?: Record<string, unknown> }): CommandResult;
export declare function skillSourceDir(): string | null;
export declare function skillTargets(options?: { cwd?: string; project?: boolean }): SkillTarget[];

export declare const GENERATED_START: string;
export declare const GENERATED_END: string;
export declare function mergeGenerated(existing: string | null, generated: string): string | null;
export declare function generatedDrift(cwd: string, config: RdkConfig, pkg: Record<string, unknown> | null): string[];

export interface LlmsFreshness {
  exists: boolean;
  managed: boolean;
  fresh: boolean | null;
  driftMs: number | null;
  modified: number | null;
  sources: string[];
  newerSources: Array<{ path: string; mtime?: number; contentDrift?: boolean }>;
}

export declare function llmsFreshness(cwd: string, config: RdkConfig, pkg: Record<string, unknown> | null): LlmsFreshness;

export interface HttpTextResult {
  ok: boolean;
  status: number | null;
  text: string;
  bytes: number;
  via: 'fetch' | 'curl' | 'none';
  error: string | null;
}

export declare function httpGetText(url: string, options?: { timeoutMs?: number; maxBytes?: number; userAgent?: string; retries?: number }): Promise<HttpTextResult>;
export declare function parseCurlStatus(stdout: string): { text: string; status: number | null };
export declare function isProbeable(url: string): boolean;

export interface ProbeResult {
  url: string;
  status: number | null;
  ok: boolean;
  error: string | null;
}

export declare function probeUrl(url: string, options?: { timeoutMs?: number; retries?: number }): Promise<ProbeResult>;
export declare function probeUrls(urls: string[], options?: { timeoutMs?: number; concurrency?: number }): Promise<ProbeResult[]>;
