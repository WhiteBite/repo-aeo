# MCP server plan (v0.2, optional)

The MCP server exists for what the CLI cannot do offline: deterministic
measurements and live integrations (GitHub API, website fetch and validation).
The skill stays offline-first; the server is the always-on monitor.

## Server identity

- Name: `repo-aeo-mcp` (kebab-case, contains `mcp`).
- Transport: stdio for local agents, plus a CLI mode for CI cron jobs.
- Deployment: Docker image for a consistent runtime.
- History: local JSON/SQLite store between calls, so it can report trends
  ("npm quality score went 0.62 → 0.81 over the last month").

## Tools (v0.1, capped at 8)

| Tool | Purpose |
| --- | --- |
| `npm_get_search_score` | quality / popularity / maintenance scores plus concrete gaps ("17 open issues, bonus needs < 15") |
| `github_audit_visibility_signals` | stars, forks, topics, release freshness, open issues, wiki/discussions presence |
| `llms_txt_check_freshness` | compare `llms.txt` mtime with the last meaningful README/docs change; alert on drift |
| `site_check_llms_txt` | HTTP check that `/llms.txt` is served on the project domain |
| `repo_get_discoverability_score` | run the same audit engine as the CLI and return the JSON report |
| `repo_list_findings` | paginated findings with severity, fix and effort |
| `competitor_scan_list_articles` | (optional) live-search scan for "Top N X tools" articles in the niche |
| `github_sync_metadata` | the only write tool; requires an ack string and a reason |

## Safety model

- Read-only by default: every tool except `github_sync_metadata` performs no
  writes anywhere.
- `github_sync_metadata` requires `ack` (must equal the configured ACK string)
  and `reason`; both are written to the local history log.
- No tool can publish, tag, release or force-push.
- Tool descriptions are 1–2 sentences; pagination, filters and limits live in
  the JSON Schema parameters, not in prose.
- Tool names follow `[service]_[action]_[object]` in `snake_case`.

## Why not ship it in v0.1

The CLI, the skill and the Action already deliver the Definition of Done. The
server adds operational surface (auth, storage, scheduling) that deserves its
own release. See [`links.md`](./links.md) for the MCP references used.
