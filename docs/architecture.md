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
```

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
The body is the four-phase workflow (AUDIT → PLAN → PATCH → VERIFY) and the
heavy lifting is delegated to `scripts/` and to the CLI, so agent context is
spent on decisions, not on re-implemented checks.

## (3) Automation

`.github/workflows/rdk-audit.yml` runs on `pull_request`, `workflow_dispatch`
and a weekly cron:

1. `actions/checkout`
2. `actions/setup-node@v4` (Node 22)
3. `npx @repo-aeo/rdk-cli audit --format github-comment --online`
4. post/update a PR comment carrying the marker
   `<!-- rdk-discoverability-audit -->` (so repeated runs edit one comment)

Autofix is a separate job chain: the `guard` job only reports `enabled=true`
when `.discoverability/project.yml` sets `safety.allow_autofix: true` **and**
there is at least one autofixable finding. The `autofix` job then creates
`rdk/autofix-<date>`, runs `rdk fix --apply`, commits and opens a pull request.

`action/action.yml` is a reusable composite action with the same steps for
repositories that prefer a single `uses:` line.

## Optional (v0.2): MCP server

See [`mcp-plan.md`](./mcp-plan.md). It exists for deterministic measurements and
live integrations (GitHub API, website fetch/validation), is read-only by
default, and caps the tool count at 8.

## Data flow invariants

1. The config is the only hand-edited source; everything else is generated or
   measured.
2. Generators are deterministic — same config, same bytes. No LLM in the loop,
   so nothing is invented.
3. Patches are idempotent: `rdk fix` twice must produce no second diff.
4. The audit never writes. `fix` writes only with `--apply`. `github-sync`
   writes only with `--apply --ack <ACK> --reason "<why>"`.
5. Publish, tag and release are never performed by any layer.
