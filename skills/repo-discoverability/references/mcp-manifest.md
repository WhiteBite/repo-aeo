# MCP manifest checks

Use this reference when the audited project is itself an MCP server (or ships
MCP tools). These checks are advisory: they are not part of the numeric score.

## Naming

- Server name is kebab-case and contains `mcp` (e.g. `repo-aeo-mcp`).
- Tool names are `snake_case` and follow `[service]_[action]_[object]`
  (e.g. `github_create_repository`) — the best tokenisation for GPT-4o class
  models and reliable tool-call parsing.
- No spaces, dots or parentheses in tool names.

## Descriptions

- 1–2 sentences per tool, concrete about what it does.
- Pagination, filters and limits belong in the JSON Schema parameters, not in
  the prose description.
- When tools depend on each other, state the call order in the description
  (workflow hint).
- Do not map a REST API 1:1 onto tools — coarse, task-shaped tools avoid extra
  model round-trips.

## Packaging & security

- Ship a Dockerfile so the runtime environment is reproducible.
- Audit dependencies before release; MCP servers hold broad credentials, so a
  single vulnerable transitive dependency is a serious risk.
- Read-only by default. Any write tool requires an explicit acknowledgement
  string plus a reason, and both are logged.
- Keep the tool count small (single digits) — discoverability beats coverage.
- Register the server in public MCP directories once it is stable.

## Dogfooding: this repository against the checklist

RDK ships its own server, `packages/repo-aeo-mcp`, so the checklist above is
applied to it directly:

| Requirement | How `repo-aeo-mcp` meets it |
| --- | --- |
| kebab-case name containing `mcp` | package and bin are both `repo-aeo-mcp` |
| `[service]_[action]_[object]`, snake_case | 9 tools, e.g. `github_audit_visibility_signals` |
| 1–2 sentence descriptions, params in the schema | descriptions state the outcome; `limit`, `severity`, `cwd`, `apply` live in `inputSchema` |
| Dockerfile | `packages/repo-aeo-mcp/Dockerfile` (`node:22-alpine`, stdio only) |
| No dependencies | zero runtime dependencies; the engine is a workspace link to `repo-aeo` |
| Read-only by default, write needs ack + reason | 8 tools annotated `readOnlyHint: true`; `github_sync_metadata` requires the configured acknowledgement string (default `I_ACK_RDK_GITHUB_WRITE`, overridable via `safety.ack`) plus a reason, binds the write to an approved plan digest (or an accepted elicitation confirmation) and previews before it writes |
| small tool count | exactly 9 |

An agent auditing this repository should read the same table as evidence, not as
a claim: `node packages/repo-aeo-mcp/bin/repo-aeo-mcp.js tools` lists the names
and `npm run test:mcp` asserts the contract (naming, annotations, schema, write
guard, JSON-RPC transport).
