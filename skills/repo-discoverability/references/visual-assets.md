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
   | MCP server / bridge | the **command outcome** in a shell terminal | remote-devbox-mcp |

4. **For agent tools:** left panel = the session **without** the tool (the
   problem), right panel = the same session **with** the tool (solved).
5. Explanatory comments sit **above** the code they describe.

## Choose the surface: what picture for what

Make no picture when the project has no observable before/after. If the project is a pure utility with no runnable surface (a formatter, a parser, a math helper), or its value is only a number (speed, size, cost), or its UI cannot be run and screenshotted headlessly, then a demo visual would be invented, not observed - skip it and put the numbers in prose instead. A dishonest picture is worse than no picture.

If you cannot run the project and capture its real output, you cannot make an honest picture.

First ask WHERE the difference between before and after manifests; the surface follows from that, never from habit:

1. In the agent's conversation or tool flow (gates, reminders, behavior rules that change what the agent does) -> terminal surface with the theme of THAT harness. Examples: dejavu-gates (opencode), stop-ai-slop (claude-code).

   ```json
   { "theme": "opencode", "takeaway": "One helper call replaces twelve lines of noise comments",
     "before": { "blocks": [ { "type": "user", "text": "add pluralize to loadUser" },
       { "type": "diff", "lines": [ { "type": "del", "text": "// twelve lines of noise comments ..." } ] } ] },
     "after": { "blocks": [ { "type": "user", "text": "add pluralize to loadUser" },
       { "type": "diff", "lines": [ { "type": "add", "text": "export const pluralize = (w) => w + 's'" } ] } ] } }
   ```

2. In file contents or shape (registries, codemods, scaffolders, config mergers) -> files surface. Example: harness-kit (three drifting configs vs one registry + merge call).

   ```json
   { "theme": "shell", "takeaway": "Three drifting configs become one registry",
     "before": { "surface": "files", "blocks": [ { "type": "file", "path": ".eslintrc", "lines": [ { "type": "del", "text": "rules: { semi: 2 }" } ] } ] },
     "after": { "surface": "files", "blocks": [ { "type": "file", "path": "config/index.js", "lines": [ { "type": "add", "text": "export const rules = { semi: 2 }" } ] } ] } }
   ```

3. In a command's outcome while the actor is a human or harness-irrelevant (CLIs, remote runners, bridges) -> terminal surface with the `shell` theme. Examples: repo-aeo audit, remote-devbox-mcp bridge.

   ```json
   { "theme": "shell", "takeaway": "One audit command lists every gap",
     "before": { "blocks": [ { "type": "user", "text": "audit this repository" },
       { "type": "diff", "lines": [ { "type": "del", "text": "score: 56/100 (grade D)" } ] } ] },
     "after": { "blocks": [ { "type": "user", "text": "audit this repository" },
       { "type": "diff", "lines": [ { "type": "add", "text": "score: 92/100 (grade A)" } ] } ] } }
   ```

4. In rendered UI (components, themes, visual tools) -> real screenshots of the product, framed by the `shots` surface, never the template. Screenshot the real running page; if it cannot run headlessly, make no picture. Self-check: if the image shows the green arrow badge it is the template, not a UI.

5. Only in numbers (time, tokens, cost, size) -> do not make a numbers-only picture; embed the numbers as payoff/status lines inside the surface chosen above.

Theme derivation: theme = the harness the actor runs in; human or generic actor => shell; when both panels are files the theme is ignored, set shell.

## Guide: numbers, matrices, topology, animation

Not every before/after is a picture. Pick the native GitHub format first; a
rendered image is the last resort, not the default.

- **Numbers only** (time, tokens, cost, size) -> a **GitHub markdown table**
  (native, dark-mode safe), plus a payoff line inside the chosen surface. Never
  a numbers-only picture.
- **Capability matrix** -> a **markdown table** with check/cross glyphs
  (`✓` / `✗`), never an image card.
- **Single topology diagram** -> a **GitHub-native Mermaid fence**. Do **not**
  set `theme` in the `init` directive - it breaks auto dark mode. Mermaid cannot
  sit in a table cell, so there is no side-by-side.
- **Before/after topology** -> deferred: pre-render light + dark with
  `mermaid-cli` and swap them via `<picture>`.
- **Animated demo** -> a **GIF via [charmbracelet/vhs](https://github.com/charmbracelet/vhs)**
  (MIT, deterministic tape -> GIF; needs `ttyd`, `ffmpeg` and fonts on `PATH`).
  GIF is the only animated format that survives a committed README asset: raw
  `<video>` and MP4 URLs are stripped by the GitHub sanitizer.

## Rendering an agent-terminal demo (the locked template)

Do not hand-draw the terminal. Use the locked template; you only fill slots, so
the result cannot look crooked.

```bash
# 1. write a slot JSON (see schema below), e.g. demo/stop-ai-slop.json
# 2. prepare it: resolve shots to data URIs, write a prepared JSON (zero-dep)
node <skill>/scripts/render-demo.mjs --data demo/stop-ai-slop.json --prepare --out demo/stop-ai-slop.prepared.json
# 3. rasterize the prepared JSON with an on-demand playwright renderer
node <renderer>/render.mjs --template <skill>/scripts/demo-terminal.html \
  --data demo/stop-ai-slop.prepared.json --out assets/demo.png --width 900 --scale 2
```

`scripts/demo-terminal.html` is the locked look (two OpenCode-style panels, a
green arrow between them, and a full-width takeaway banner below).
`scripts/render-demo.mjs` is a **preparer**: it fills the shot slots (reads each
`shot` file, inlines it as a data URI, reads the PNG dimensions) and writes a
prepared JSON. The template never touches the filesystem and the preparer carries
no runtime dependency. Rasterization is a separate, on-demand step: any
playwright-core renderer that loads the template and calls
`window.fillTemplate(prepared)` works (the repo ships none). If `playwright-core`
happens to be resolvable, `render-demo.mjs` rasterizes in one step and
`--prepare` is unnecessary.

### Slot schema (v4)

Top-level: `schema` (optional; must be `4` when present, and an absent key means
4), `theme` (`opencode` | `claude-code` | `codex` | `shell`), `windowTitle` (the
session part; the theme supplies the window prefix), `takeaway` (**required**:
one plain-language sentence rendered in the full-width banner below both panels).
`arrowCaption`, `statusLeft` and
`statusRight` are ignored since v3.
Per panel (`before`, `after`): `caption`, `sessionTitle`, `surface`, `blocks[]`.
`usage`, `agentName`, `agentModel`, `inputAgent`, `inputModel` and
`inputProvider` are ignored since v3.
`surface` is `terminal` (default), `files` or `shots`. A `files` panel drops the
traffic lights and the input box and renders the titlebar as neutral editor
chrome, for demos whose essence is a config or repo artifact rather than an
agent session. A `shots` panel drops the titlebar, the session title and the
input box and frames a real screenshot instead (see "Shots surface" below).
`blocks[]` is an ordered event stream:
`{type:"user"|"prose"|"tool"|"status"|"done",text}`,
`{type:"diff",lines:[...]}`, `{type:"file",path,lines:[...]}` or
`{type:"steps",steps:[...]}`. `tool` takes an optional `kind`
(`call|read|write|search`) that picks the theme's glyph. A `file` block is a card
with a muted mono `path` header and diff-style lines below, tinted by panel like
`diff`. Text supports `` `code` `` and `**bold**`.
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

### Shots surface (real screenshots)

A `shots` panel frames a real screenshot of the running product. It is the only
honest surface for rendered UI: never fake a UI with terminal lines, and never
embed the template itself.

Per panel: `surface: "shots"`, `shot` (path to a PNG, resolved relative to the
slot JSON's directory), `shotScale` (default 2), `shotCaption` (a strip under
the image) and `annotations[]`. `caption` and `sessionTitle` are accepted, but
the session title is hidden. **Blocks are forbidden on a shots panel** - a
screenshot is self-contained evidence, and terminal lines around it would fake a
session.

`annotations[]` entries are `{x, y, w, h, label?, color?, dim?}` where `x/y/w/h`
are fractions in `0..1` of the image box, so they land on the same region at any
render scale. `color` is `red` (default) or `green`; `dim: true` darkens
everything outside the rect; `label` is a chip on the rect's top-left corner.

```json
{ "theme": "shell", "takeaway": "The empty state now shows the next action",
  "before": { "surface": "shots", "shot": "shots/before.png", "shotCaption": "before: blank panel",
    "annotations": [ { "x": 0.08, "y": 0.62, "w": 0.5, "h": 0.16, "label": "no next step", "dim": true } ] },
  "after": { "surface": "shots", "shot": "shots/after.png", "shotCaption": "after: guided",
    "annotations": [ { "x": 0.08, "y": 0.62, "w": 0.5, "h": 0.16, "label": "next step", "color": "green" } ] } }
```

Rules:

- **Capture at DPR 2.** `shotScale` defaults to 2 and `--shot-w` is
  `shotW / shotScale`, so a 2x capture renders at its CSS size. A 1x capture
  upscales soft.
- **Legibility.** Capture the region that proves the point at **<= ~440 CSS px
  wide**; never embed a full desktop window - it shrinks to unreadable mush at
  README width.
- **Letterbox, never crop.** The image is contained (`max-height: 420px`,
  `max-width: 100%`); cropping a real screenshot can hide the UI that proves the
  point.
- **PNG only for auto-sizing.** The preparer reads the PNG IHDR for `shotW` /
  `shotH`. A non-PNG shot must author `shotW` and `shotH` in the slot JSON or
  the preparer errors out.

### Steps block (a numbered run)

`{type:"steps",steps:[{text,state}]}` renders a numbered list inside a
`terminal` or `files` panel (it is a block, not a surface). `state` is `ok`
(green check), `pain` (red cross) or `removed` (muted dash, struck-through
text). At most **8** entries render; the rest collapse into a `... +N more
steps` line. A per-panel integer `collapses` adds a green `collapses N steps`
line after the blocks - use it on the after panel to show a long manual run
reduced to one step.

```json
{ "type": "steps", "steps": [
  { "text": "open the settings file", "state": "pain" },
  { "text": "find the right key", "state": "pain" },
  { "text": "run the helper", "state": "ok" } ] }
```

Validate a slot before rendering: `node scripts/check-slot.mjs demo/<name>.json`
exits non-zero on any schema error (missing takeaway, more than 5 blocks per
panel, a line over 50 characters, an unknown theme or surface, a `shots` panel
without a `shot`) and prints warnings for an absent surface, an unknown block
type, blocks on a `shots` panel, or a `steps` block with more than 8 entries.

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
