---
name: repo-discoverability
description: >-
  Make a repository, npm package or docs site discoverable and recommendable to
  humans, AI agents and search engines. Use when asked to "make repo
  discoverable", "add GitHub topics", "improve README for users and agents",
  "prepare npm metadata", "generate AGENTS.md", "why is my package not
  recommended", "optimize for AI search", "GEO/AEO for my repo", "add llms.txt",
  "audit repo discoverability", "run a distribution campaign", "submit to
  awesome lists", "get my package listed", or before publishing/releasing a
  package.
  Only activate on an explicit user request; do not use for routine code edits,
  commits or PRs. Produces an audit, a plan and small verified patches; never
  publishes, tags or force-pushes without an explicit ACK.
---

# Repo discoverability (RDK)

Turn a repository into something that people, coding agents and search engines
can find, understand and recommend. Works offline by default; every claim in the
report is derived from files in the repository, never invented.

## Non-negotiables

1. **Facts first.** Read `.discoverability/project.yml`, `package.json`,
   `README.md`, `AGENTS.md` before proposing anything. If a value is unknown,
   mark it `TODO` — do not guess.
2. **Never** run `npm publish`, `git tag`, `git push --force`, delete files, or
   change repository settings without an explicit human ACK string and a stated
   reason. Audit-only is the default mode.
3. **Small diffs.** One finding per commit-sized change. No drive-by rewrites.
4. **Verify** every change: tests, `npm pack --dry-run`, link checks.
5. Heavy logic lives in `scripts/` (code does not burn context; only its output
   does). Prefer running the CLI over re-implementing checks inline.
6. **Outbound submissions** (PRs to curated lists, registries) go out only
   after the human approves the target list, the exact entry and the fork
   plan. Record every submission in `.discoverability/submissions.json`.

## The five phases

### Phase 1 — AUDIT (collect facts)

```bash
# offline by default; --online adds link checks and GitHub API reads
node packages/rdk-cli/bin/rdk.js audit --format json
node packages/rdk-cli/bin/rdk.js audit --format markdown      # human report
node packages/rdk-cli/bin/rdk.js audit --format github-comment
```

If `.discoverability/project.yml` does not exist yet, run `rdk init` (preview
first) to scaffold it from `package.json` and the git remote.

The audit scores six axes (0–100, renormalised over the axes that apply):
GitHub metadata, README primitives, agent readiness, npm readiness, docs
readiness, trust & hygiene. Each finding carries `severity`, `why`, `fix`,
`effort` and whether it is autofixable.

### Phase 2 — PLAN (Finding → Why → Fix → Risk → Effort)

Build a table before touching code. Example:

| Finding | Why it matters | Fix | Risk | Effort |
| --- | --- | --- | --- | --- |
| `github.topics_count` (8 of 20) | topics are a GitHub search key | add 4 capability topics to `keywords.github_topics` | low | S |
| `readme.first_success_path` | agents/users drop off before install | move install+run block above the fold | low | S |
| `npm.exports` missing `require` | CJS consumers break | add `require` condition to exports | medium | M |
| `agents.exists` | agents guess how to test | draft AGENTS.md, human review required | low | S |

Order by severity × weight. Anything marked `error` goes first.

### Phase 3 — PATCH (small diffs)

Safe, idempotent autofixes (formatting, missing sections, stub files):

```bash
node packages/rdk-cli/bin/rdk.js fix               # preview is the default
node packages/rdk-cli/bin/rdk.js fix --apply       # only when the diff is right
node packages/rdk-cli/bin/rdk.js npm-surface       # publish-surface report
node packages/rdk-cli/bin/rdk.js github-sync       # preview is the default; writes need --apply --ack --reason --plan-digest
```

Everything else (real examples, version bumps, exports redesign, claims with
sources) is manual — write the smallest possible patch and keep the existing
voice of the project.

### Phase 4 — VERIFY

```bash
npm test                                   # or the project's test command
node packages/rdk-cli/bin/rdk.js npm-surface   # tarball contents; npm pack runs by default, --no-pack skips it
node packages/rdk-cli/bin/rdk.js audit --online       # links + GitHub API
node packages/rdk-cli/bin/rdk.js audit --format json  # score must not regress
```

If the score dropped, revert the patch and re-plan.

### Phase 5 — DISTRIBUTE (get listed)

```bash
npx repo-aeo submit --search                                # candidate lists via gh
npx repo-aeo submit --targets owner/list --category "Tools"  # preview the PR plan
npx repo-aeo-mcp submissions --live                          # campaign state + live PR statuses
```

Find the curated lists where the project's audience already lives, propose
the entry, and keep the ledger in `.discoverability/submissions.json`.
Read `references/distribution-playbook.md` before the first submission: it has the
per-list conventions that decide whether a PR survives review, the fork
mechanics (create just-in-time, delete after merge) and the safety rails —
no submission without an approved target list.

## What "good" looks like (checklist)

- **README**: install/run in the first 60 lines, 2–5 short examples, sections
  "Who is it for", "Use cases", "Why choose this", "Status/roadmap", claims with
  numbers and named sources.
- **GitHub**: 1–2 sentence description, 8–20 lowercase hyphenated topics,
  homepage URL.
- **npm**: `description`, `keywords` (5–15), `repository`, `homepage`, `bugs`,
  `exports` with `import` + `require`, `types`, `sideEffects` only when certain,
  `engines`, `files` including `llms.txt` / `llms-full.txt` / `AGENTS.md`.
- **Agent-facing**: `AGENTS.md` with working test/lint/build commands, a
  repository map and do/don't rules — written or reviewed by a human.
- **Docs surface** (when a site/homepage exists): `llms.txt`, `llms-full.txt`,
  reviewed JSON-LD.
- **Trust**: `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS`,
  `CITATION.cff`, clean `.gitignore`/`.gitattributes`, no leaked secrets.

## Safety rails for agents

- Publishing, tagging, releasing and force-pushing are **out of scope** for this
  skill. If the user asks for them, stop and ask for an explicit ACK.
- `github-sync` writes only with `--apply --ack <ACK> --reason "<why>" --plan-digest <DIGEST>` (the digest of the dry-run preview, so the write binds to the approved plan).
- Autofix branches are reviewable: the Action opens a PR instead of pushing to
  the default branch.

## References (load only when needed)

- `references/checks-catalog.md` — read when you need the exact weight or fix text of a finding id.
- `references/scoring.md` — read when you need to explain or predict how the 0–100 score moves.
- `references/mcp-manifest.md` — read if the project ships an MCP server.
- `references/geo-playbook.md` — read before writing positioning or discovery copy; it explains why these moves work.
- `references/distribution-playbook.md` — read before proposing the project to any curated list; it explains entry conventions, fork mechanics and submission tracking.
- `scripts/audit.sh` — run if Node is not on PATH; a thin wrapper around the CLI.
