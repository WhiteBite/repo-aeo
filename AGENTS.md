# AGENTS.md

> Operational instructions for coding agents (Codex, Cursor, OpenCode, Claude Code).
> Drafted by `rdk fix`, then reviewed and extended by hand — verify every command
> before relying on it. Fully generated instruction files are known to reduce task
> success, so treat this document as a reviewed contract, not a template.

Project: **repo-aeo** — Repo Discoverability Kit (RDK).

## Commands

```bash
npm test                                  # node --test "packages/*/test/*.test.js"
node packages/rdk-cli/bin/rdk.js audit    # discoverability audit (offline, read-only)
node packages/rdk-cli/bin/rdk.js audit --online   # adds link checks + GitHub API reads
node packages/rdk-cli/bin/rdk.js fix --dry-run    # preview safe autofixes
node packages/rdk-cli/bin/rdk.js fix --apply      # write the safe autofixes
node packages/rdk-cli/bin/rdk.js npm-surface      # package.json publish surface
node packages/repo-aeo-mcp/bin/repo-aeo-mcp.js score   # MCP server in CLI mode (score + trend)
node packages/repo-aeo-mcp/bin/repo-aeo-mcp.js serve   # MCP server on stdio
```

There is no build step: the CLI is plain ESM JavaScript for Node >= 18 with zero
runtime dependencies. `npm test` is the full gate. There is no separate lint
step yet — keep the style of the file you are editing and run `npm test` after
every change.

## Repository map

| Path | Purpose |
| --- | --- |
| `packages/rdk-cli/src/yaml.js` | dependency-free YAML subset parser |
| `packages/rdk-cli/src/config.js` | `.discoverability/project.yml` loading, defaults, seeding |
| `packages/rdk-cli/src/audit/checks/` | one module per axis; each check is declarative |
| `packages/rdk-cli/src/audit/score.js` | axis weights and the 0–100 model |
| `packages/rdk-cli/src/fix/patches.js` | idempotent safe autofix patches |
| `packages/rdk-cli/src/generate/index.js` | deterministic artifact generators |
| `packages/rdk-cli/src/commands/` | CLI commands (init, audit, fix, npm-surface, github-sync) |
| `packages/repo-aeo-mcp/src/tools.js` | the 8 MCP tools; every tool is read-only except the guarded sync |
| `packages/repo-aeo-mcp/src/history.js` | metric history in `.discoverability/cache/metrics.json` (trends) |
| `packages/repo-aeo-mcp/src/server.js` | dependency-free MCP stdio JSON-RPC 2.0 transport |
| `skills/repo-discoverability/` | the agent skill (SKILL.md + references) |
| `action/`, `.github/workflows/rdk-audit.yml` | GitHub Action and composite action |
| `fixtures/demo-repo/` | the before/after demo repo used by tests and REPORT.md |
| `.discoverability/project.yml` | source of truth for this repository's metadata |

## Do / Don't

- **Do** run `npm test` before committing; the suite covers the YAML parser, the
  audit, the patches (including idempotency), the CLI end to end, the MCP tool
  registry and the JSON-RPC transport.
- **Do** keep `packages/repo-aeo-mcp` free of runtime dependencies too: it
  reuses `@whitebite/rdk-cli` for the engine and implements the MCP transport
  itself.
- **Do** keep `.discoverability/project.yml` and `packages/rdk-cli/package.json`
  in sync — `rdk audit` compares them.
- **Do** add a new check as a declarative entry in the matching
  `src/audit/checks/*.js` module, with `why`/`fix` text that a non-author can act on.
- **Don't** add runtime dependencies to `packages/rdk-cli` without discussing it:
  zero dependencies is a deliberate product property (npx stays fast, supply
  chain stays small). The MCP package must stay dependency-free as well, apart
  from the workspace link to the CLI.
- **Don't** let an MCP tool write by default: `github_sync_metadata` must keep
  requiring the ack string, a reason and an explicit `apply: true`.
- **Don't** bump versions, create tags, publish, force-push or delete files
  without explicit human confirmation.
- **Don't** rewrite unrelated files while fixing a specific finding.
- **Don't** make a patch non-idempotent: `rdk fix` twice must produce no diff.
