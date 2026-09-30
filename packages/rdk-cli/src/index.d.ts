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
  evidence?: string | null;
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
  options?: { only?: string[] | null; skip?: string[] },
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
