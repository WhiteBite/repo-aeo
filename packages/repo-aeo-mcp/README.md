# repo-aeo-mcp

Continuous discoverability monitoring as an [MCP](https://modelcontextprotocol.io) server.

The CLI (`@repo-aeo/rdk-cli`) audits a repository once, on demand. This server keeps the same engine available to an AI agent or a monitoring job, adds a **trend history** so regressions are visible, and wraps everything in the tool format agents already know.

- 8 tools, zero runtime dependencies, Node.js >= 18
- Read-only by default: the single write tool previews first and requires an acknowledgement
- Same 0-100 score as the CLI, recorded locally per run so you can see `71 -> 84` over time

## Install and run

```bash
npx repo-aeo-mcp serve      # speak MCP over stdio
```

From a checkout of this repository:

```bash
npm run mcp                 # same thing, via the workspace script
```

The server talks newline-delimited JSON-RPC 2.0 over stdio, so it drops into any MCP client. For Claude Code:

```bash
claude mcp add rdk -- npx repo-aeo-mcp serve
```

### Docker

```bash
docker build -t repo-aeo-mcp packages/repo-aeo-mcp
docker run -i repo-aeo-mcp serve
```

Mount a repository to audit something other than the working directory:

```bash
docker run -i -v "$PWD:/repo" -w /repo repo-aeo-mcp serve
```

## Tools

| Tool | What it answers |
| --- | --- |
| `repo_get_discoverability_score` | The full 0-100 score, per-axis breakdown and every finding for a repository, plus the trend since the last run. |
| `repo_list_findings` | Findings filtered by severity, ordered so the highest-leverage fix comes first. |
| `npm_get_search_score` | The live npms.io score (final/quality/popularity/maintenance) and the gaps that block the completeness bonus. Falls back to registry metadata when npms.io is unreachable. |
| `github_audit_visibility_signals` | Live description, homepage, topics, stars, licence and push freshness from `gh`. |
| `llms_txt_check_freshness` | Whether `llms.txt` is older than its sources, and by how much. |
| `site_check_llms_txt` | Whether a docs site actually serves `/llms.txt`, with size and first heading. |
| `competitor_scan_list_articles` | Who is mentioned in "top N tools" listicles for your keywords (needs `RDK_SEARCH_ENDPOINT`). |
| `github_sync_metadata` | Writes description/homepage/topics from `.discoverability/project.yml` to GitHub. **The only write tool.** |

### Safety model

Every tool is annotated `readOnlyHint: true` except `github_sync_metadata`, which is annotated `destructiveHint: true` and additionally:

1. requires `ack` to equal `I_ACK_RDK_GITHUB_WRITE`,
2. requires a `reason` of at least 5 characters, which is stored in the local history,
3. **previews by default** - pass `apply: true` only after reviewing `output`.

The same guard is implemented once, in the CLI, and reused here.

## Configuration

The server reads the repository it is pointed at; nothing else is required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RDK_SEARCH_ENDPOINT` | unset | JSON search API accepting `?q=` and returning `{ results: [{ title, url, snippet }] }`. Enables `competitor_scan_list_articles`. |

History lives in `.discoverability/cache/metrics.json` and is git-ignored.

## Command line

`serve` is the default, but every tool is also callable directly, which makes the server easy to script and to test:

```bash
repo-aeo-mcp serve                 # MCP over stdio
repo-aeo-mcp score [--json]        # score + trend
repo-aeo-mcp findings --severity error
repo-aeo-mcp npm-score typescript
repo-aeo-mcp github owner/name
repo-aeo-mcp freshness
repo-aeo-mcp site https://example.com
repo-aeo-mcp history
repo-aeo-mcp tools
```

## Programmatic use

```js
import { handleMessage } from 'repo-aeo-mcp';

const response = await handleMessage({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'repo_get_discoverability_score', arguments: { cwd: process.cwd() } },
});
```

## Licence

MIT
