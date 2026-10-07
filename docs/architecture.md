# Architecture

Three layers, because no single artifact makes discoverability "just happen".

```
                ┌──────────────────────────────────────────────┐
                │  .discoverability/project.yml               │
                │  (single source of truth)                   │
                └───────────────┬──────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────────┐
        ▼                       ▼                           ▼
┌───────────────┐     ┌───────────────────┐      ┌────────────────────┐
│ (1) Repo Kit  │     │ (2) Skillpack     │      │ (3) Automation     │
│ templates +   │     │ SKILL.md +        │      │ rdk-audit.yml      │
│ generators +  │     │ references +      │      │ PR comment +       │
│ linters       │     │ scripts/          │      │ optional autofix   │
│               │     │                   │      │ PR                 │
└───────┬───────┘     └─────────┬─────────┘      └─────────┬──────────┘
        │                       │                          │
        └──────────────► packages/rdk-cli ◄────────────────┘
                          (the only engine)
                                        │
                                        ▼
                          ┌────────────────────────┐
                           │ (4) MCP server         │
                           │ packages/repo-aeo-mcp  │
                           │ 9 tools, stdio, Docker │
                           └────────────────────────┘
```

The distribution campaign (`rdk channels`/`submit`/`track`, section (5) below)
runs on the same engine and reads the same config; its state lives in a
committed ledger beside the config.

## (1) Repo Kit

- `.discoverability/project.yml` — project identity, audiences, use cases,
  keywords (GitHub topics + npm keywords), links, quickstart, artifacts,
  differentiators, safety switches.
- Templates and generators live in the CLI (`src/generate/index.js`) so that a
  skill, an Action and a human all produce byte-identical output.
- Linters are the audit checks (`src/audit/checks/`), one module per axis.

## (2) Skillpack

`skills/repo-discoverability/SKILL.md` follows the Agent Skills format: YAML
frontmatter with a trigger-rich `name`/`description`, because OpenCode and
similar runtimes load only those two fields before deciding to use the skill.
The body is the five-phase workflow (AUDIT → PLAN → PATCH → VERIFY →
DISTRIBUTE) and the
heavy lifting is delegated to `scripts/` and to the CLI, so agent context is
spent on decisions, not on re-implemented checks.

## (3) Automation

`.github/workflows/rdk-audit.yml` runs on `pull_request`, `workflow_dispatch`
and a weekly cron. It dogfoods the marketplace action
[`WhiteBite/rdk-discoverability`](https://github.com/WhiteBite/rdk-discoverability)
with a `cli` override pointing at the in-repo engine, so every PR is gated by
its own code, not by the published package:

1. `actions/checkout`
2. `uses: WhiteBite/rdk-discoverability@v1` — runs the audit, posts/updates a
   PR comment carrying the marker `<!-- rdk-discoverability-audit -->` (so
   repeated runs edit one comment), and gates the run on `min_score`

The marketplace wrapper is a separate repository (a root `action.yml` is
required for the Actions listing); it pulls the engine from npm by default
and its `sync-engine` workflow retags it automatically on every engine
release.

Autofix is a separate job chain: the `guard` job only reports `enabled=true`
when `.discoverability/project.yml` sets `safety.allow_autofix: true` **and**
there is at least one autofixable finding. The `autofix` job then creates
`rdk/autofix-<date>`, runs `rdk fix --apply`, commits and opens a pull request.

## (4) MCP server

`packages/repo-aeo-mcp` exposes the same engine to AI agents and monitoring
jobs over MCP stdio. It adds two things the CLI cannot do:

- **Trend history** — every call is appended to
  `.discoverability/cache/metrics.json`, so the server can answer "your npm
  quality score went 0.62 → 0.81 over the last month" instead of a bare number.
- **Live integrations** — `gh` for GitHub visibility signals, HTTP for
  `/llms.txt` checks, npms.io for the published score.

Design constraints: zero runtime dependencies, a single-digit tool count,
names in `[service]_[action]_[object]`, every tool annotated with MCP hints, and exactly
one write tool (`github_sync_metadata`) which reuses the CLI's guarded
implementation, requires an ack string plus a reason, and **previews by
default** (`apply: true` is opt-in, mirroring `rdk fix`). See
[`mcp-plan.md`](./mcp-plan.md) for the tool table and safety model.

## (5) Distribution tracking

The campaign state lives beside the engine, not inside it:

- **Ledger** — `.discoverability/submissions.json` is committed state: one row
  per submission with `channel`, `mechanism`, `artifact`, `target`, `pr_url`,
  `status` and a `dedupe_key`. Status machine
  `prepared -> submitted -> listed`, terminal negatives
  `rejected|closed|unlisted|failed` allow one retry. The ledger is never
  auto-repaired: an unparsable file fails every command that reads it.
- **Cache** — live probe snapshots go to `.discoverability/cache/tracking.json`
  (schema `rdk-tracking/1`, git-ignored, safe to lose). Recorded status changes
  only through the guarded writes below.
- **Probes** — each channel descriptor names one hydration source: `gh-pr` for
  git-pr channels (PR state via `gh`), and presence checks for the rest —
  `crawl` (sitemap fetch), `http-search` (registry search) and `registry-read`
  (npm package document). A probe failure degrades to the recorded state,
  never to a guess.
- **Canonical status** — `buildDistributionStatus` projects the ledger through
  the probes into one deterministic object (schema `rdk-distribution/1`): per
  item the attention state (`action_required|awaiting_review|approved|stale|
  none|listed|terminal`) and, when something is due, the exact guarded command
  to run next. CLI `rdk track [--json]` and the MCP tool
  `distribution_check_submissions` render the same object.
- **Writes** — `rdk track --adopt` (pull pre-ledger `rdk/*` PRs in), `--sync`
  (rewrite recorded statuses from live probes) and `--mark <target> --status
  <status>` (manual override of one row) all preview by default and write only
  under `--apply --ack <ACK> --reason "<why>" --plan-digest <DIGEST>`, the same
  guard chain as `submit` and `github-sync`.
- **Automation** — `.github/workflows/rdk-track.yml` runs weekly: `rdk track
  --json` plus an upsert of the tracking issue carrying the attention summary
  and the action queue. It reads the ledger and never writes it.

## Data flow invariants

1. The config is the only hand-edited source; everything else is generated or
   measured.
2. Generators are deterministic — same config, same bytes. No LLM in the loop,
   so nothing is invented.
3. Patches are idempotent: `rdk fix` twice must produce no second diff.
4. The audit never writes. `fix` writes only with `--apply`. `github-sync`
   writes only with `--apply --ack <ACK> --reason "<why>"`. The MCP write tool
   keeps the same guard and adds a preview step before it.
5. Publish, tag and release are never performed by any layer.
