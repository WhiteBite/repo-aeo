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
- Keep the tool count small in v1 (≤ 8) — discoverability beats coverage.
- Register the server in public MCP directories once it is stable.
