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
node <skill>/scripts/render-demo.mjs --data demo/stop-ai-slop.json --out assets/demo.png --width 900
```

`scripts/demo-terminal.html` is the locked look (two OpenCode-style panels, a
green arrow between them, and a full-width takeaway banner below).
`scripts/render-demo.mjs` fills it from JSON and screenshots to PNG via a cached
Chromium (no browser download). If playwright is unavailable, fall back to your
own screenshot capability on the same template.

### Slot schema (v4)

Top-level: `theme` (`opencode` | `claude-code` | `codex` | `shell`), `windowTitle` (the
session part; the theme supplies the window prefix), `takeaway` (one
plain-language sentence rendered in the full-width banner below both panels;
omit it and the banner is hidden). `arrowCaption`, `statusLeft` and
`statusRight` are ignored since v3.
Per panel (`before`, `after`): `caption`, `sessionTitle`, `surface`, `blocks[]`.
`usage`, `agentName`, `agentModel`, `inputAgent`, `inputModel` and
`inputProvider` are ignored since v3.
`surface` is `terminal` (default) or `files`: a `files` panel drops the traffic
lights and the input box and renders the titlebar as neutral editor chrome, for
demos whose essence is a config or repo artifact rather than an agent session.
`blocks[]` is an ordered event stream:
`{type:"user"|"prose"|"tool"|"status"|"done",text}`,
`{type:"diff",lines:[...]}` or `{type:"file",path,lines:[...]}`. `tool` takes an
optional `kind` (`call|read|write|search`) that picks the theme's glyph. A
`file` block is a card with a muted mono `path` header and diff-style lines
below, tinted by panel like `diff`. Text supports `` `code` `` and `**bold**`.
A diff line is either `{type:"add"|"del"|"ctx",text}` (a string line, kept
verbatim) or `{type:"add"|"del"|"ctx",left,right}` (two aligned mono columns, so
authors who forget manual padding still get table alignment). The `+`/`-`/space
sign is added by CSS in both forms.

Legibility rules (v4):

- Keep each panel to **at most 5 blocks**: the user command, one or two short
  body lines, the red pain block (before) or green payoff block (after), and a
  done/status line.
- Keep every body line to **~50 characters**; trim longer content in the slot
  JSON rather than letting it overflow the panel.
- Design at **900 CSS px** total width (the stage is fixed at 900 px, so opening
  the HTML directly cannot stretch it) and render at `--width 900 --scale 2`
  (PNG 1800 px wide), so the image stays legible when GitHub downscales it to
  ~800 px.
- The two windows are equal height: the shorter panel stretches to the taller
  one and both input boxes sit on the same bottom line, so asymmetric
  before/after content stays aligned.
- Traffic lights are honored per theme: `opencode` and `shell` show them,
  `claude-code` and `codex` do not.

Minimal example:

```json
{
  "theme": "opencode",
  "windowTitle": "add pluralize to loadUser",
  "takeaway": "One helper call replaces twelve lines of noise comments",
  "before": {
    "caption": "without plugin",
    "sessionTitle": "# add pluralize to loadUser",
    "blocks": [
      { "type": "user", "text": "add pluralize to loadUser" },
      { "type": "prose", "text": "I'll add a `pluralize` helper." },
      { "type": "diff", "lines": [
        { "type": "del", "text": "// twelve lines of noise comments ..." },
        { "type": "del", "text": "// TODO: add a TTL later" }
      ] },
      { "type": "status", "text": "12 comment lines written" }
    ]
  },
  "after": {
    "caption": "with plugin",
    "sessionTitle": "# add pluralize to loadUser",
    "blocks": [
      { "type": "user", "text": "add pluralize to loadUser" },
      { "type": "prose", "text": "I'll add a `pluralize` helper." },
      { "type": "diff", "lines": [
        { "type": "add", "text": "// pluralize — one line, above the code" },
        { "type": "add", "text": "export const pluralize = (w) => w + 's'" }
      ] },
      { "type": "done", "text": "done in 2.4s" }
    ]
  }
}
```

## Choose the surface: what picture for what

First ask WHERE the difference between before and after manifests; the surface
follows from that, never from habit:

1. In the agent's conversation or tool flow (gates, reminders, behavior rules
   that change what the agent does) -> terminal surface with the theme of THAT
   harness. Examples: dejavu-gates (opencode), stop-ai-slop (claude-code).
2. In file contents or shape (registries, codemods, scaffolders, config
   mergers) -> files surface. Example: harness-kit (three drifting configs vs
   one registry + merge call).
3. In a command's outcome while the actor is a human or harness-irrelevant
   (CLIs, remote runners, bridges) -> terminal surface with the `shell` theme.
   Examples: repo-aeo audit, remote-devbox-mcp bridge.
4. In rendered UI (components, themes, visual tools) -> real screenshots of the
   product, never the template; the template must not fake a UI it cannot run.
5. Only in numbers (time, tokens, cost, size) -> do not make a numbers-only
   picture; embed the numbers as payoff/status lines inside the surface chosen
   above.

Theme honesty rule: the theme is the harness chrome you are mimicking; never
borrow another harness's chrome for a different actor (no OC titlebar on a
human CLI session, no claude chrome on a codex run). When the actor is generic
or human, use `shell`.

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
- A catch-all `* text` / `* text eol=...` rule in `.gitattributes` strips CRLF
  bytes out of committed PNG/GIF blobs, so README images render broken on
  GitHub; add a `*.png binary` line after the catch-all and re-commit the asset.

## Safety rails

- The renderer and any recorder are **external, on-demand** tools. Never add a
  runtime dependency to `rdk-cli` or `repo-aeo-mcp`.
- repo-aeo never renders or writes binary assets itself; the agent does.
- Keep the asset honest: render the real commands/output of the project, not an
  invented product.
