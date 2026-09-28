# Scoring model

```
total       = Σ(axis_score × axis_weight) / Σ(axis_weight)   over applicable axes
axis_score  = round(100 × passed_checks / total_checks)
```

Axis weights sum to 100:

| Axis | Weight | Applies when |
| --- | --- | --- |
| GitHub metadata | 20 | always |
| README primitives | 25 | always |
| Agent readiness | 15 | always |
| npm readiness | 20 | `package.json` exists or `artifacts.has_npm_package` |
| Docs readiness | 12 | `artifacts.has_docs_site` or `links.homepage`/`links.docs` |
| Trust & hygiene | 8 | always |

Grades: **A** ≥ 90 · **B** ≥ 80 · **C** ≥ 70 · **D** ≥ 55 · **F** below.

## Why weights, not a checklist

A missing `exports` map breaks every consumer of a library; a missing
`.gitattributes` is cosmetic. Weights encode that asymmetry, and the per-axis
breakdown tells a maintainer where the next hour of work pays off most.

Check-by-check weights live in
[`../skills/repo-discoverability/references/checks-catalog.md`](../skills/repo-discoverability/references/checks-catalog.md).

## Exit codes (CI friendly)

| Code | Meaning |
| --- | --- |
| 0 | success (or score ≥ `--min-score`) |
| 1 | usage error, or a write command refused (missing `--ack`/`--reason`) |
| 2 | score below `--min-score` |

Example gate:

```yaml
- run: npx @repo-aeo/rdk-cli audit --min-score 70
```

## What the score is not

It is not a measure of code quality, and it is not a promise that an AI will
recommend the project tomorrow. It measures the *retrievable surface*: the
metadata that live grounding actually reads. Long-term recommendation also
depends on training-data presence, which only time and web footprint move.
