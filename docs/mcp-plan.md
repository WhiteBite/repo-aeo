# MCP server: `repo-aeo-mcp`

Status: **implemented** (`packages/repo-aeo-mcp`, v0.1.0).

The MCP server exists for what the CLI cannot do offline: deterministic
measurements and live integrations (GitHub API, website fetch and validation).
The skill stays offline-first; the server is the always-on monitor.

## Server identity

- Name: `repo-aeo-mcp` (kebab-case, contains `mcp`).
- Transport: stdio for local agents, plus a CLI mode for CI cron jobs.
- Deployment: `packages/repo-aeo-mcp/Dockerfile`, `node:22-alpine`, nothing
  exposed over the network.
- History: `.discoverability/cache/metrics.json` (git-ignored), appended on
  every call, so the server reports trends ("npm quality score went
  0.62 → 0.81 over the last month").
- Protocol: newline-delimited JSON-RPC 2.0. `initialize` negotiates: a client
  version the server knows (`2024-11-05` … `2025-11-25`) is echoed back,
  anything else falls back to the server's latest (`2025-11-25`). `initialize`,
  `notifications/initialized`, `ping`, `tools/list`, `tools/call`, plus empty
  `resources/list` and `prompts/list` answers so probing clients do not see
  `method not found`.

## Tools (9: 8 read-only + 1 writer)

| Tool | Purpose |
| --- | --- |
| `npm_get_search_score` | quality / popularity / maintenance scores plus concrete gaps ("17 open issues, bonus needs < 15") |
| `github_audit_visibility_signals` | stars, forks, topics, release freshness, open issues, wiki/discussions presence |
| `llms_txt_check_freshness` | compare `llms.txt` mtime with the last meaningful README/docs change; alert on drift |
| `site_check_llms_txt` | HTTP check that `/llms.txt` is served on the project domain |
| `repo_get_discoverability_score` | run the same audit engine as the CLI and return the JSON report |
| `repo_list_findings` | findings with severity, fix and effort |
| `competitor_scan_list_articles` | (optional) live-search scan for "Top N X tools" articles in the niche |
| `distribution_check_submissions` | canonical campaign status (schema `rdk-distribution/1`) from `.discoverability/submissions.json`: per-item attention, next command, live PR state via `gh`, live presence for non-PR channels; `adopt`/`sync` are read-only previews with a `plan_digest` |
| `github_sync_metadata` | the only write tool; requires an ack string and a reason |

Every tool carries MCP annotations: eight are `readOnlyHint: true`,
`github_sync_metadata` is `readOnlyHint: false, destructiveHint: true`.

## Safety model

- Read-only by default: every tool except `github_sync_metadata` performs no
  writes anywhere.
- `github_sync_metadata` requires `ack` (must equal the configured ACK string)
  and `reason`; both are written to the local history log.
- `github_sync_metadata` **previews by default**: `apply` defaults to `false`,
  so an agent must explicitly opt in after reading the plan, exactly like
  `rdk fix`.
- No tool can publish, tag, release or force-push.
- Tool descriptions are 1–2 sentences; pagination, filters and limits live in
  the JSON Schema parameters, not in prose.
- Tool names follow `[service]_[action]_[object]` in `snake_case`.
- The guard is implemented once, in the CLI, and reused by the server, so the
  two surfaces cannot drift apart.

## What the server adds over the CLI

| Need | CLI | MCP server |
| --- | --- | --- |
| One-shot audit in CI | yes | yes (`repo_get_discoverability_score`) |
| Trend across runs | no | yes (local metric history) |
| Live GitHub / site / npms probes | `audit --online`, `github-sync` | dedicated tools, no flags to remember |
| Campaign status and ledger previews | `rdk track [--json]`, `--adopt`/`--sync` dry runs | `distribution_check_submissions` (read-only; writes stay in the CLI) |
| Guarded write | `--apply --ack … --reason …` | ack + reason + preview-first |
| Run it from an agent | no | yes, over MCP stdio |

## Running it

```bash
npx repo-aeo-mcp serve                  # stdio
claude mcp add rdk -- npx repo-aeo-mcp serve
docker run -i repo-aeo-mcp serve        # container
repo-aeo-mcp score                      # CLI mode for cron jobs
```

`RDK_SEARCH_ENDPOINT` enables `competitor_scan_list_articles`; without it the
tool reports that it is not configured instead of guessing.

## Tests

`packages/repo-aeo-mcp/test/` covers the tool registry contract (naming,
annotations, JSON Schema), the write guard, the audit/freshness/history tools
and the JSON-RPC transport (handshake, notifications, error codes, junk input).
Run with `npm run test:mcp`.
