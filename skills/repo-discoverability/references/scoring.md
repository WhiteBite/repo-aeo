# Scoring

```
total = Σ(axis_score × axis_weight) / Σ(axis_weight)     over applicable axes
axis_score = round(100 × passed_checks / total_checks)
```

Axis weights: GitHub 20 · README 25 · Agents 15 · npm 20 · Docs 12 · Hygiene 8.

Grades: A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 55 · F below.

Applicability rules:

- **npm axis** applies when `package.json` exists or
  `artifacts.has_npm_package: true`.
- **docs axis** applies when `artifacts.has_docs_site: true` or
  `links.homepage` / `links.docs` is set.
- All other axes always apply.

Why weighted points instead of a flat checklist: a missing `exports` map breaks
every consumer, while a missing `.gitattributes` is cosmetic. The weights encode
that, and the per-axis breakdown tells the user *where* to spend effort.

Exit codes for CI: `rdk audit --min-score 70` exits `2` when the score is below
the threshold, which is how the GitHub Action can gate a pull request.
