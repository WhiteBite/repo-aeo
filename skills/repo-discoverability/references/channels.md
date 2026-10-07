# Channel matrix

Every distribution channel RDK knows, with what the mechanism implies. This is
the breadth view for choosing targets; the procedure for each mechanism lives
in `distribution-playbook.md`.

| Channel id | Mechanism | Artifact | Applies when | Gating | Dedupe key | Auth |
| --- | --- | --- | --- | --- | --- | --- |
| `awesome-list` | `git-pr` | `readme-row` | public git repo (host/owner/repo resolvable) | automatable (guarded write) | `awesome-list:<target>` | gh login |
| `mcp-official-registry` | `http-json` | `server.json` | project is an MCP server | automatable (guarded write) | `mcp-official-registry:<target>` | `MCP_REGISTRY_TOKEN` (bearer) |
| `mcp-directory-form` | `web-form` | `form-payload` | project is an MCP server | human-gated (RDK prepares, never submits) | `mcp-directory-form:<channel id>` | none (browser session) |
| `skills-sh` | `passive` | none | project ships a skill (`skills/*/SKILL.md`) | human-gated (nothing to submit; meet preconditions, verify later) | `skills-sh:<channel id>` | none |
| `npm-registry` | `cli-publish` | `npm-tarball` | project has a publishable npm package | human-gated (RDK prepares the checklist, never publishes) | `npm-registry:<package>` | npm credentials (held by the human/CI) |

Statuses in `.discoverability/submissions.json` move `prepared -> submitted
-> open -> listed`, with `needs_changes` marking a maintainer
changes-request; `rejected|closed|unlisted|failed` are terminal negatives that
allow one retry. `rdk channels` prints applicability, recorded status and the
next action per channel; `rdk track` reports the live campaign status and the
guarded action queue; `rdk submit --channel <id>` defaults to `awesome-list`. The descriptor's `probe` field selects the live hydrator: only
`gh-pr` has one (`gh pr view`), so rows on other probe kinds keep their
recorded state until a human or `rdk submit` updates them.

## Which mechanism, why

The mechanism class is chosen by how the channel actually accepts entries,
and it decides how far RDK may go on its own. A curated list takes a README
row through a pull request, so the whole loop (fork, insert, PR) is
scriptable — `git-pr`, automatable behind the ack guard. The official MCP
registry exposes an authenticated JSON API, so submission is one POST with a
dedupe GET in front — `http-json`, also automatable, but only after the npm
package carrying the `mcpName` marker exists, which RDK never publishes.
Directories like mcp.so accept entries only through a browser form, so the
tool's job ends at a prepared payload plus a field checklist — `web-form`,
human-gated. Indexes like skills.sh crawl on their own: there is no intake at
all, only crawlability preconditions and an after-the-fact presence check —
`passive`. And a registry whose intake is `npm publish` sits on the
listings-only boundary: RDK names the artifact and writes the exact command
checklist, and a human or CI runs it — `cli-publish`. The rule underneath:
automate what has a reviewable programmatic surface, prepare-and-hand-off
what requires a human credential or a human click, and never cross into
publishing.
