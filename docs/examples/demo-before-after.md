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

**Score: 51/100 (grade F)** — generated 2026-10-01T14:24:16.040Z

██████████░░░░░░░░░░ 51/100

| Axis | Score | Weight | Status |
| --- | --- | --- | --- |
| GitHub metadata | 100/100 | 20 | complete |
| README primitives | 29/100 | 25 | 2/7 checks passed |
| Agent readiness | 60/100 | 15 | 3/5 checks passed |
| npm readiness | 40/100 | 20 | 4/10 checks passed |
| Docs readiness | 33/100 | 12 | 2/6 checks passed |
| Trust & hygiene | 33/100 | 8 | 3/9 checks passed |

Checks: 18/41 passed · errors 10 · warnings 13 · info 8 · autofixable 20
```

## Step 1 — `rdk init --apply`

```text
Applied 15 patch group(s), wrote 16 file(s):
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
Applied 3 patch group(s):
  - package.metadata: Seed package.json metadata from the config
  - package.keywords: Top up package.json keywords from the config
  - package.engines: Declare engines.node

Wrote 3 file(s):
  + package.json
  + package.json
  + package.json

Reminder: AGENTS.md and README stubs are drafts — review them by hand before committing.
Never publish, tag or force-push from an autofix branch without an explicit ACK.
```

## After

```text
# Discoverability audit — demo-widget

**Score: 83/100 (grade B)** — generated 2026-10-01T14:30:30.143Z

█████████████████░░░ 83/100

| Axis | Score | Weight | Status |
| --- | --- | --- | --- |
| GitHub metadata | 75/100 | 20 | 3/4 checks passed |
| README primitives | 86/100 | 25 | 6/7 checks passed |
| Agent readiness | 80/100 | 15 | 4/5 checks passed |
| npm readiness | 70/100 | 20 | 7/10 checks passed |
| Docs readiness | 100/100 | 12 | complete |
| Trust & hygiene | 100/100 | 8 | complete |

Checks: 35/41 passed · errors 0 · warnings 6 · info 4 · autofixable 2
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

`README.md` after autofix (hand-written lines preserved verbatim, scaffold
sections appended):

```markdown
# demo-widget

A small demo package used to show what the Repo Discoverability Kit changes.

Install it and look at the source.

## Quickstart

**Prerequisites:** Node.js >= 18

```bash
npm install demo-widget
npm run start
```

## Who is it for

<!-- TODO: describe the primary audiences (1-3 bullets) -->

## Use cases

<!-- TODO: list 3-7 concrete use cases -->

## Examples
```

The findings that remain after autofix are the honest, manual ones: a real
description, real examples, an `exports` map and TypeScript types.
