# Visual demo assets (the essence rule)

A repository that only *describes* itself in text makes the reader work. A demo
visual shows what the project does in one glance. This reference tells you how
to produce one that reads as **real**, and how to keep every repo in a family
consistent.

## The essence rule (read this first)

1. **Show the EFFECT, not the tool's log.** Never screenshot `BLOCKED: 2 slop`.
   Show what changed for the user: `12 comment lines -> 1 comment line`.
2. **Format is before -> after, side by side, with an arrow between.**
3. **The environment must be the real one for the project type:**

   | Project type | Environment to show | Example |
   | --- | --- | --- |
   | Agent tool (plugin / CLI for coding agents) | the **agent terminal** (OpenCode / Claude Code look) | stop-ai-slop, dejavu-gates |
   | Web / UI app | a real **screenshot** of the page | Domain-Hunter |
   | Library / config tool (no runnable surface) | **before/after of the artifact** it manages | harness-kit |
   | MCP server | an agent session calling the MCP tool | remote-devbox-mcp |

4. **For agent tools:** left panel = the session **without** the tool (the
   problem), right panel = the same session **with** the tool (solved).
5. Explanatory comments sit **above** the code they describe.

## Rendering an agent-terminal demo (the locked template)

Do not hand-draw the terminal. Use the locked template; you only fill slots, so
the result cannot look crooked.

```bash
# 1. write a slot JSON (see schema below), e.g. demo/stop-ai-slop.json
# 2. render it (needs playwright-core; install on demand, never a repo dep)
node <skill>/scripts/render-demo.mjs --data demo/stop-ai-slop.json --out assets/demo.png
```

`scripts/demo-terminal.html` is the locked look (two OpenCode-style panels +
green arrow). `scripts/render-demo.mjs` fills it from JSON and screenshots to
PNG via a cached Chromium (no browser download). If playwright is unavailable,
fall back to your own screenshot capability on the same template.

### Slot schema

Top-level: `windowTitle`, `arrowCaption`, `statusLeft`, `statusRight`.
Per panel (`before`, `after`): `caption`, `sessionTitle`, `usage`,
`userMessage`, `prose[]`, `tools[]`, `diff[{type,text}]`, `status`,
`agentName`, `agentModel`, `inputAgent`, `inputModel`, `inputProvider`.
`diff.type` is `add` (green `+`), `del` (red `-`) or `ctx`.

Minimal example:

```json
{
  "windowTitle": "OC | add pluralize to loadUser",
  "arrowCaption": "stop-ai-slop plugin",
  "before": {
    "caption": "without plugin",
    "sessionTitle": "# add pluralize to loadUser",
    "userMessage": "add pluralize to loadUser",
    "prose": ["I'll add a pluralize helper."],
    "tools": ["* Edit src/pluralize.ts"],
    "diff": [
      { "type": "add", "text": "// twelve lines of noise comments ..." },
      { "type": "add", "text": "export const pluralize = (w) => w + 's'" }
    ]
  },
  "after": {
    "caption": "with plugin",
    "sessionTitle": "# add pluralize to loadUser",
    "userMessage": "add pluralize to loadUser",
    "prose": ["I'll add a pluralize helper."],
    "tools": ["* Edit src/pluralize.ts"],
    "diff": [
      { "type": "add", "text": "// pluralize — one line, above the code" },
      { "type": "add", "text": "export const pluralize = (w) => w + 's'" }
    ]
  }
}
```

## Storing and embedding

- Commit the asset under `assets/` (family convention). Budget **2-5 MB**.
- Commit the **slot JSON next to it** (`demo/<name>.json`) — it is the source of
  truth; re-render with `render-demo.mjs` to refresh, never hand-edit the PNG.
- Embed with **markdown** so the relative path is validated by
  `readme.local_links`: `![demo](assets/demo.png)` near the top of the README.
- Dark/light variants via the `#gh-dark-mode-only` / `#gh-light-mode-only`
  fragments.
- Never embed a committed `.mp4` (GitHub strips `<video>`), an animated SVG
  (unreliable in README), or any `<iframe>`/`<script>` (stripped).

## Safety rails

- The renderer and any recorder are **external, on-demand** tools. Never add a
  runtime dependency to `rdk-cli` or `repo-aeo-mcp`.
- repo-aeo never renders or writes binary assets itself; the agent does.
- Keep the asset honest: render the real commands/output of the project, not an
  invented product.
