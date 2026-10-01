# Demo: fixtures/demo-repo before and after

Real output of `rdk` against the fixture in [`fixtures/demo-repo`](../../fixtures/demo-repo),
copied to a scratch directory so the fixture stays in its "before" state.

Reproduce with:

```bash
cp -r fixtures/demo-repo /tmp/rdk-demo && cd /tmp/rdk-demo
npx repo-aeo audit            # before
npx repo-aeo init --apply
npx repo-aeo fix --apply
npx repo-aeo audit            # after
```

## Before

```text
# Discoverability audit — demo-widget

**Score: 29/100 (grade F)** — generated 2026-10-01T11:39:26.287Z

██████░░░░░░░░░░░░░░ 29/100

| Axis | Score | Weight | Status |
| --- | --- | --- | --- |
| GitHub metadata | 50/100 | 20 | 2/4 checks passed |
| README primitives | 14/100 | 25 | 1/7 checks passed |
| Agent readiness | 60/100 | 15 | 3/5 checks passed |
| npm readiness | 20/100 | 20 | 2/10 checks passed |
| Docs readiness | 17/100 | 12 | 1/6 checks passed |
| Trust & hygiene | 11/100 | 8 | 1/9 checks passed |

Checks: 10/41 passed · errors 12 · warnings 13 · info 6 · autofixable 20
```

## Step 1 — `rdk init --apply`

```text
Applied 14 patch group(s), wrote 16 file(s):
  + .discoverability/project.yml
  + README.md
  + AGENTS.md
  + llms.txt
  + llms-full.txt
  + LICENSE
  + SECURITY.md
  + CONTRIBUTING.md
  + CITATION.cff
  + .gitignore
  + .gitattributes
  + .github/ISSUE_TEMPLATE/bug_report.md
  + .github/ISSUE_TEMPLATE/feature_request.md
  + .github/PULL_REQUEST_TEMPLATE.md
  + .github/CODEOWNERS
  + docs/jsonld.jsonld
```

## Step 2 — `rdk fix --apply`

```text
Applied 6 patch group(s) in 2 passes:
  - llms.generate: Generate llms.txt and llms-full.txt
  - package.metadata: Seed package.json metadata from the config
  - package.keywords: Top up package.json keywords from the config
  - package.engines: Declare engines.node
  - readme.examples_stub: Add example stubs to the README
  - llms.generate: Generate llms.txt and llms-full.txt

Wrote 6 file(s):
  + llms-full.txt
  + package.json
  + package.json
  + package.json
  + README.md
  + llms-full.txt

Reminder: AGENTS.md and README stubs are drafts — review them by hand before committing.
Never publish, tag or force-push from an autofix branch without an explicit ACK.
```

## After

```text
# Discoverability audit — demo-widget

**Score: 73/100 (grade C)** — generated 2026-10-01T11:39:26.796Z

███████████████░░░░░ 73/100

| Axis | Score | Weight | Status |
| --- | --- | --- | --- |
| GitHub metadata | 75/100 | 20 | 3/4 checks passed |
| README primitives | 71/100 | 25 | 5/7 checks passed |
| Agent readiness | 80/100 | 15 | 4/5 checks passed |
| npm readiness | 50/100 | 20 | 5/10 checks passed |
| Docs readiness | 83/100 | 12 | 5/6 checks passed |
| Trust & hygiene | 100/100 | 8 | complete |

Checks: 31/41 passed · errors 0 · warnings 6 · info 4 · autofixable 3
```

## What the generated files look like

`.discoverability/project.yml` (seeded — the TODOs are deliberate, a human
fills them in):

```yaml
project:
  name: "demo-widget"
  one_liner: "TODO: one sentence describing what this does and who it is for"   # 1 sentence, shown as the GitHub description
  description: "TODO: one sentence describing what this does and who it is for"
  category: "library"   # library | app | template | research | tool | dataset | mcp-server

audiences: []
```

`README.md` after autofix (scaffolded quickstart + sections + example stub):

```markdown
# demo-widget
## Quickstart

```bash
npm install demo-widget
npm run start
```


A small demo package used to show what the Repo Discoverability Kit changes.

Install it and look at the source.

## Who is it for

<!-- TODO: who is this for? -->

## Use cases

<!-- TODO: 3-7 concrete use cases -->

## Why choose this
```

The findings that remain after autofix are the honest, manual ones: a real
description, real examples, an `exports` map and TypeScript types.
