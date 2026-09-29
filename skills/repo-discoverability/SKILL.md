---
name: repo-discoverability
description: >-
  Make a repository, npm package or docs site discoverable and recommendable to
  humans, AI agents and search engines. Use when asked to "make repo
  discoverable", "add GitHub topics", "improve README for users and agents",
  "prepare npm metadata", "generate AGENTS.md", "why is my package not
  recommended", "optimize for AI search", "GEO/AEO for my repo", "add llms.txt",
  "audit repo discoverability", or before publishing/releasing a package.
  Produces an audit, a plan and small verified patches; never publishes, tags or
  force-pushes without an explicit ACK.
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

## The four phases

### Phase 1 — AUDIT (collect facts)

```bash
# offline by default; --online adds link checks and GitHub API reads
node packages/rdk-cli/bin/rdk.js audit --format json
node packages/rdk-cli/bin/rdk.js audit --format markdown      # human report
node packages/rdk-cli/bin/rdk.js audit --format github-comment
```

If `.discoverability/project.yml` does not exist yet, run `rdk init` (dry run
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
node packages/rdk-cli/bin/rdk.js fix --dry-run     # review the diff first
node packages/rdk-cli/bin/rdk.js fix --apply       # only when the diff is right
node packages/rdk-cli/bin/rdk.js npm-surface       # publish-surface report
node packages/rdk-cli/bin/rdk.js github-sync --dry-run
```

Everything else (real examples, version bumps, exports redesign, claims with
sources) is manual — write the smallest possible patch and keep the existing
voice of the project.

### Phase 4 — VERIFY

```bash
npm test                                   # or the project's test command
node packages/rdk-cli/bin/rdk.js npm-surface --pack   # tarball contents
node packages/rdk-cli/bin/rdk.js audit --online       # links + GitHub API
node packages/rdk-cli/bin/rdk.js audit --format json  # score must not regress
```

If the score dropped, revert the patch and re-plan.

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
- `github-sync` writes only with `--apply --ack <ACK> --reason "<why>"`.
- Autofix branches are reviewable: the Action opens a PR instead of pushing to
  the default branch.

## References (load only when needed)

- `references/checks-catalog.md` — every check, its weight and its fix.
- `references/scoring.md` — how the 0–100 score is computed.
- `references/mcp-manifest.md` — checks for projects that ship an MCP server.
- `references/geo-playbook.md` — why these moves work for AI discovery.
- `scripts/audit.sh` — thin wrapper around the CLI for agents without Node on PATH.
