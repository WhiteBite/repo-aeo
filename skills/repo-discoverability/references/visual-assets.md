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
   | MCP server / bridge | the **topology** when the essence is *where* the work runs, else the **command outcome** in a shell terminal | remote-devbox-mcp (topology) |

4. **For agent tools:** left panel = the session **without** the tool (the
   problem), right panel = the same session **with** the tool (solved).
5. Explanatory comments sit **above** the code they describe.

## Choose the surface: what picture for what

Make no picture when the project has no observable before/after. If the project is a pure utility with no runnable surface (a formatter, a parser, a math helper), or its value is only a number (speed, size, cost), or its UI cannot be run and screenshotted headlessly, then a demo visual would be invented, not observed - skip it and put the numbers in prose instead. A dishonest picture is worse than no picture.

If you cannot run the project and capture its real output, you cannot make an honest picture.

Step 0 - before choosing a surface: list the product's value props from its own
README/docs, pick the one no adjacent tool offers, and show THAT defining
mechanism - not the value prop that is merely easiest to draw. If the defining
mechanism is temporal (fail -> learn -> remind -> block -> heal; pipeline
stages; retry loops), a static before/after loses the time axis: make an
animated GIF with the frames mode below.

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

3. In a command's outcome while the actor is a human or harness-irrelevant (CLIs, remote runners) -> terminal surface with the `shell` theme. Example: repo-aeo audit.

   ```json
   { "theme": "shell", "takeaway": "One audit command lists every gap",
     "before": { "blocks": [ { "type": "user", "text": "audit this repository" },
       { "type": "diff", "lines": [ { "type": "del", "text": "score: 56/100 (grade D)" } ] } ] },
     "after": { "blocks": [ { "type": "user", "text": "audit this repository" },
       { "type": "diff", "lines": [ { "type": "add", "text": "score: 92/100 (grade A)" } ] } ] } }
   ```

4. In WHERE the work runs, or which machine/actor performs it (a bridge, proxy or remote runner that offloads work to another host - the orchestrator has no hardware, the user's machine does) -> a **single topology diagram as a native Mermaid fence**; the command outcome is the consequence, not the essence. Example: remote-devbox-mcp.

   ```mermaid
   flowchart LR
     A["cloud sandbox<br/>agent (LLM)<br/>no toolchain"]
     C["your machine<br/>JDK · Gradle · your project"]
     A <== "tool calls -> outbound tunnel" ==> C
   ```

5. In rendered UI (components, themes, visual tools) -> real screenshots of the product, framed by the `shots` surface, never the template. Screenshot the real running page; if it cannot run headlessly, make no picture. Self-check: if the image shows the green arrow badge it is the template, not a UI.

6. Only in numbers (time, tokens, cost, size) -> do not make a numbers-only picture; embed the numbers as payoff/status lines inside the surface chosen above.

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
- **Before/after topology** -> pre-render light + dark with `mermaid-cli` and
  swap them via `<picture>` (recipe below).
- **Animated demo** -> a **GIF via [charmbracelet/vhs](https://github.com/charmbracelet/vhs)**
  (MIT, deterministic tape -> GIF; needs `ttyd`, `ffmpeg` and fonts on `PATH`).
  GIF is the only animated format that survives a committed README asset: raw
  `<video>` and MP4 URLs are stripped by the GitHub sanitizer.

### Before/after topology (pre-rendered Mermaid)

A single topology stays a **native Mermaid fence** (auto dark mode, no asset). A
before/after pair cannot: native Mermaid cannot sit in a table cell, so the two
diagrams must be pre-rendered and placed side by side.

1. Write the two sources, `before.mmd` and `after.mmd`.
2. Render each with [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli)
   (MIT, puppeteer-backed). Install it on demand **outside the repo** - it is a
   guide tool, never a dependency of `rdk-cli` or `repo-aeo-mcp`:

   ```bash
   npx -y @mermaid-js/mermaid-cli -i before.mmd -o assets/before-diagram-dark.png -s 2
   npx -y @mermaid-js/mermaid-cli -i after.mmd  -o assets/after-diagram-dark.png  -s 2
   ```

   `-s 2` renders at 2x so the PNG stays legible when GitHub downscales it.
3. Render the light pass with a light `themeVariables` set that keeps contrast
   (dark text, light fills, visible borders), e.g. a `light.json` config:

   ```json
   { "theme": "base",
     "themeVariables": { "background": "#ffffff", "primaryColor": "#e8f6ec",
       "primaryTextColor": "#1b1b1b", "primaryBorderColor": "#15803d",
       "lineColor": "#6a6a6a", "fontFamily": "ui-monospace, monospace" } }
   ```

   ```bash
   npx -y @mermaid-js/mermaid-cli -i before.mmd -o assets/before-diagram-light.png -s 2 -c light.json
   npx -y @mermaid-js/mermaid-cli -i after.mmd  -o assets/after-diagram-light.png  -s 2 -c light.json
   ```
4. Embed each pair with the same `<picture>` snippet as the terminal demo (dark
   file as the dark source, light file as the fallback).

Warnings: never set `theme` in a `%%{init}%%` directive on a **native** fence -
it breaks GitHub's auto dark mode. Native Mermaid cannot sit in a table cell, so
side-by-side before/after must be pre-rendered. A single topology stays a native
fence.

### Animated family-look demo (frames mode)

When the defining mechanism unfolds in time (a gate that fires on the third
recurrence, a pipeline that collapses), render the locked template once per
moment and assemble a GIF. The frames file is a JSON **array** of complete slot
JSONs (schema v4 each), one per beat of the story.

**Scaffold rule.** A temporal story uses the `single` surface: one full-width
window the viewer watches unfold, beat by beat. The two-panel `compare` scaffold
(before | arrow | after) is for **static** before/after cards only - forcing a
temporal story into two half-width windows shrinks the text and turns "watch a
session" into "compare two stills". Set `"surface": "single"` on the panel that
carries the story (or at the top level, which uses the `before` panel); the
template hides the arrow and the other panel and renders one window at full
stage width.

**Typing / streaming.** A terminal that only swaps whole states reads as a
slideshow. Two kinds of line stream, at different granularity, because a real
terminal types input and streams output:

- **Typed lines** - what a human or the agent INPUTS: the `user` block text,
  agent prose/decision lines, and tool-call command text. They grow by **2-3
  characters** per frame at `delay` 0.03s - a keystroke run. Write the partial
  strings yourself; the template does not animate. A typed run is several frames
  ending on the complete line. This is the per-character model
  [charmbracelet/vhs](https://github.com/charmbracelet/vhs) uses: its
  `Set TypingSpeed` is seconds per key press, so 0.03s per key is ~33 chars/s -
  fast terminal typing.
- **Streamed lines** - system/tool OUTPUT: `status`, `done`, `diff` lines,
  plugin messages (`[dejavu] REMINDER`/`CORRECTION`/`EVIDENCE`) and command
  output. They are NOT typed; they arrive in **1-2 fast word chunks** at `delay`
  0.06-0.08s, because a program writes output in buffered chunks, not
  keystrokes. A streamed run is 1-2 intermediates ending on the complete line.

The frame after a run is the beat hold that reveals the result.

If the product reacts to recurrence, show the recurrence itself: repeat the
identical call line on every attempt and let the reaction (counter, gate card,
hud) escalate beside it - counters appearing without their attempts read as
magic.

- **Never invent tool output lines.** Copy the tool's real message strings from
  its source; state the tool keeps silently (counters, store state) belongs in
  the hud annotation labeled as store state, not in the session stream.

**Per-frame delays.** Give each frame a `delay` (seconds) in the frames JSON:
typed frames are 0.03s, streamed frames are 0.06-0.08s, beat frames hold
0.9-1.2s so the eye reads the result, and the final frame holds 3s. The delay is
read at assembly time, not by the template.

**GIF delay floor.** Never author a `delay` below 0.02s. GIF frame delays are
stored in centiseconds, and Blink/WebKit/Gecko clamp any delay under 20ms up to
100ms - so a 0.01s "fast typing" frame silently becomes a 10fps slideshow
instead of the intended speed. 0.03s (3cs) is the fastest safe typed frame;
`validateSlot` warns on a numeric `delay` in `(0, 0.02)`.

**Height.** In `single` mode the window is a fixed height (520px) and the input
box is pinned to the bottom, so every frame renders at the same canvas height
regardless of how many blocks it carries - no banner jump. Keep the cumulative
session to <= 12 blocks and drop the oldest output lines once it overflows:
scroll-off is honest for a terminal. Lines may run to 80 chars in `single` mode
(the inner column is ~810px, so 13px mono fits ~100) - use the room for real
content (full error text, the correction sentence, evidence counts), not stubs.

1. Write `demo/<name>.frames.json`. Each frame repeats the scaffold and adds or
   highlights the next beat; put `"hl": true` on the block or diff line the eye
   must land on (the gate firing, the correction).
2. Prepare all frames (zero-dep; resolves shots, writes `frame-NN.json` and the
   ffmpeg `list.txt`):

   ```bash
   node skills/repo-discoverability/scripts/render-demo.mjs --frames demo/<name>.frames.json --out-dir build/frames
   ```

3. Rasterize each prepared frame with the on-demand playwright renderer at
   **scale 1**, width 900: a 2x GIF doubles bytes for no README gain.
4. Assemble with ffmpeg (on demand, outside the repo) through the concat demuxer
   so each frame keeps its own duration. The renderer already wrote
   `<out-dir>/list.txt` - a `file` + `duration` pair per frame, then the last
   frame repeated with `duration 3.0` for the end hold - so you never hand-build
   it:

   ```text
   file 'frame-00.png'
   duration 1
   file 'frame-01.png'
   duration 0.12
   ...
   file 'frame-30.png'
   duration 1.2
   file 'frame-30.png'
   duration 3.0
   ```

   ```bash
   ffmpeg -y -f concat -safe 0 -i list.txt -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" -fps_mode passthrough -loop 0 assets/<name>.gif
   ```

   `-fps_mode passthrough` is required: the GIF encoder defaults to 25fps and
   silently drops the 0.03s typed frames otherwise, skipping keystrokes.

   Keep the palettegen/paletteuse quality rule. Budget <= ~1.5 MB; over budget,
   in order: palettegen `max_colors=128`, then 3-char typed chunks, then width
   800 - never a palette below 128 colors or dropped beats.
5. Embed the GIF like any image. Keep a static PNG sibling only when the story
   also has an honest one-glance still; `check-slot.mjs` validates a frames
   file element by element.

### End-to-end pipeline

One copy-pasteable run from a frames file to a committed GIF. Placeholders:
`<repo>` is the repo-aeo checkout, `<scratch>` is a scratch dir outside the repo,
`<name>` is the demo name.

```bash
# 1. scratch setup (on demand, outside the repo; never a repo dependency)
mkdir demo-render && cd demo-render && npm i playwright-core

# 2. prepare every frame (zero-dep; writes frame-NN.json + list.txt)
node <repo>/skills/repo-discoverability/scripts/render-demo.mjs \
  --frames demo/<name>.frames.json --out-dir build

# 3. rasterize each prepared frame (scale 1, width 900)
for f in build/frame-*.json; do
  node <repo>/skills/repo-discoverability/scripts/rasterize.mjs \
    --template <repo>/skills/repo-discoverability/scripts/demo-terminal.html \
    --data "$f" --out "${f%.json}.png" --width 900 --scale 1 \
    --playwright-dir <scratch>
done

# 4. assemble the GIF (ffmpeg on demand, outside the repo)
ffmpeg -y -f concat -safe 0 -i build/list.txt \
  -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" \
  -fps_mode passthrough -loop 0 assets/<name>.gif
```

`rasterize.mjs` resolves `playwright-core` from `--playwright-dir` (or
`$PLAYWRIGHT_DIR`, else a probed scratch root) and supersedes the historical
temp-dir `render.mjs`, which was ephemeral and never reproducible from the repo.

## Rendering an agent-terminal demo (the locked template)

Do not hand-draw the terminal. Use the locked template; you only fill slots, so
the result cannot look crooked.

```bash
# 1. write a slot JSON (see schema below), e.g. demo/stop-ai-slop.json
# 2. prepare it: resolve shots to data URIs, write a prepared JSON (zero-dep)
node <skill>/scripts/render-demo.mjs --data demo/stop-ai-slop.json --prepare --out demo/stop-ai-slop.prepared.json
# 3. rasterize the prepared JSON with the on-demand rasterizer
node <skill>/scripts/rasterize.mjs --template <skill>/scripts/demo-terminal.html \
  --data demo/stop-ai-slop.prepared.json --out assets/demo.png --width 900 --scale 2 \
  --playwright-dir <scratch>
```

`scripts/demo-terminal.html` is the locked look (two OpenCode-style panels, a
green arrow between them, and a full-width takeaway banner below).
`scripts/render-demo.mjs` is a **preparer**: it fills the shot slots (reads each
`shot` file, inlines it as a data URI, reads the PNG dimensions) and writes a
prepared JSON. The template never touches the filesystem and the preparer carries
no runtime dependency. Rasterization is a separate, on-demand step:
`scripts/rasterize.mjs` loads the template, calls `window.fillTemplate(prepared)`
and screenshots it, resolving `playwright-core` from `--playwright-dir` (or
`$PLAYWRIGHT_DIR`, else a probed scratch root). If `playwright-core` happens to be
resolvable from the repo, `render-demo.mjs` rasterizes in one step and
`--prepare` is unnecessary.

### Capture real output (`--from-command`)

A demo is only honest if its lines are the project's real output. Capture first,
review, then paste - never type the lines from memory:

```bash
node <skill>/scripts/render-demo.mjs --from-command "npx repo-aeo audit" --max-lines 8
```

The command runs through the shell (`--cwd <dir>` sets the working directory),
stdout and stderr are merged, and the exit code is captured. The script prints a
JSON array of slot blocks to stdout and **writes no file**: the first block is
the `tool` call, the last up-to-`--max-lines` output lines follow as `status`
blocks (a single `... N earlier lines omitted` status replaces the dropped
prefix), and a final `done` (`exit 0`) or `status` (`exit <code>`) block closes
the run. Lines over 50 characters are tail-truncated with an ellipsis, so the
array passes `check-slot.mjs` unchanged. Review it, then paste it into the
panel's `blocks[]` in the slot JSON. This is the mechanism that makes "real
output" provable: the lines came from the command, not from the author.

### Slot schema (v4)

Top-level: `schema` (optional; must be `4` when present, and an absent key means
4), `theme` (`opencode` | `claude-code` | `codex` | `shell`), `windowTitle` (the
session part; the theme supplies the window prefix), `takeaway` (**required**:
one plain-language sentence rendered in the full-width banner below both panels).
`palette` (`dark` default | `light`) is orthogonal to `theme`: `theme` is the
harness chrome identity (prefix, glyphs, traffic lights), `palette` is the color
scheme. `light` swaps the whole scheme to a paper-ish page, white windows, dark
text and light red/green diff tints; every surface (terminal, files, shots
captions and annotation chips, steps glyphs, the takeaway banner) stays legible.
`arrowCaption`, `statusLeft` and
`statusRight` are ignored since v3.
Per panel (`before`, `after`): `caption`, `sessionTitle`, `surface`, `blocks[]`.
`usage`, `agentName`, `agentModel`, `inputAgent`, `inputModel` and
`inputProvider` are ignored since v3.
`surface` is `terminal` (default), `files`, `shots` or `single`. A `files` panel
drops the traffic lights and the input box and renders the titlebar as neutral
editor chrome, for demos whose essence is a config or repo artifact rather than
an agent session. A `shots` panel drops the titlebar, the session title and the
input box and frames a real screenshot instead (see "Shots surface" below). A
`single` panel is animation-only: it hides the arrow and the other panel and
renders one full-width window (the `caption` becomes a muted beat label above
it), for temporal stories that must be watched rather than compared - the
two-panel `compare` scaffold stays for static before/after cards.
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
Blocks and diff lines accept `hl: true` to spotlight one beat (amber tint plus a
left bar) - the frame-mode eye anchor.
On an after panel every diff line is tinted green and on a before panel red,
regardless of add/del/ctx - put narration you do not want tint-shifted into a
status or prose block instead.

Three v4 mechanisms carry a temporal story's state and its turning points:

- `hud` (top-level, optional): `{text, tone}` renders a thin strip between the
  titlebar and the body of every window - the tool's learned/persistent state
  that survives session boundaries. `text` is the right-aligned state string;
  `tone` is `muted` (gray), `learn` (amber, counting), `block` (red-amber,
  enforcing) or `heal` (green). An absent `hud` hides the strip; it adapts to
  the light palette.
- `{type:"gate",title,lines:[...]}`: an amber-bordered card, visually distinct
  from the red pain / green payoff blocks - the exact moment the tool intervenes
  (teach or block). `title` is the amber bold header (a shield glyph leads it);
  `lines` are amber-tinted mono body lines.
- `{type:"divider",text}`: a muted centered `── text ──` rule - a session or
  phase boundary, so cross-session persistence of the `hud` is visible.

Legibility rules (v4):

- Keep each panel to **at most 5 blocks**: the user command, one or two short
  body lines, the red pain block (before) or green payoff block (after), and a
  done/status line. A `single` panel is the exception: up to **12 blocks** and
  lines up to **80 characters**, because it owns the full stage width.
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
panel - 12 on a `single` panel, a line over 50 characters - 80 on `single`, an
empty `single` panel, an unknown theme or surface, a `shots` panel without a
`shot`) and prints warnings for an absent surface, an unknown block type, blocks
on a `shots` panel, or a `steps` block with more than 8 entries.

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
- Ship both schemes with a `<picture>` element: the dark render is the
  `prefers-color-scheme: dark` source, the light render is the `<img>` fallback.
  GitHub documents this pattern and its sanitizer keeps `<picture>` and
  `<source>`:

  ```html
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/x.png">
    <img alt="..." src="assets/x-light.png">
  </picture>
  ```

  Render the same slot JSON twice (palette absent or `dark`, then `palette:
  "light"`) and commit both PNGs. Shipping a single dark variant remains
  acceptable - the `<picture>` pair is an upgrade, not a requirement.
- Never embed a committed `.mp4` (GitHub strips `<video>`), an animated SVG
  (unreliable in README), or any `<iframe>`/`<script>` (stripped).
- A catch-all `* text` / `* text eol=...` rule in `.gitattributes` strips CRLF
  bytes out of committed binary assets, so README images render broken on
  GitHub; add lines for every binary you ship (`*.png`, `*.gif`, `*.jpg`,
  `*.jpeg`, `*.webp`, `*.mp4`) after the catch-all and re-commit the asset.
  Without a catch-all rule git usually auto-detects binaries by NUL bytes, but
  do not rely on that.

## Safety rails

- The renderer and any recorder are **external, on-demand** tools. Never add a
  runtime dependency to `rdk-cli` or `repo-aeo-mcp`.
- repo-aeo never renders or writes binary assets itself; the agent does.
- Keep the asset honest: render the real commands/output of the project, not an
  invented product.
