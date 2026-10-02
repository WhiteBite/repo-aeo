# Checks catalog

Weights are per-axis points; an axis score is `passed / total * 100`. Axes are
renormalised over the axes that apply to the project (npm only when a package
exists, docs only when a homepage/docs site is configured).

## GitHub metadata (weight 20)

| Check | Weight | Fix |
| --- | --- | --- |
| `github.description` | 10 | 1–2 sentence `project.one_liner` in the config |
| `github.topics_count` | 12 | 8–20 topics in `keywords.github_topics` |
| `github.topics_format` | 6 | lowercase, hyphens, no duplicates (`rdk fix`) |
| `github.homepage` | 6 | set `links.homepage` and sync |

## README primitives (weight 25)

| Check | Weight | Fix |
| --- | --- | --- |
| `readme.exists` | 10 | scaffold from the config (`rdk init`) |
| `readme.first_success_path` | 15 | install + run commands in the first 60 lines |
| `readme.examples` | 12 | 2–5 short runnable examples |
| `readme.audience_sections` | 12 | Who is it for / Use cases / Why choose this / Status |
| `readme.heading_structure` | 6 | one H1, ≥4 H2s |
| `readme.verifiable_claims` | 6 | numbers with named sources |
| `readme.local_links` | 4 | relative links must resolve |

## Agent readiness (weight 15)

| Check | Weight | Fix |
| --- | --- | --- |
| `agents.exists` | 15 | AGENTS.md at the root (draft + human review) |
| `agents.commands` | 15 | document test/lint/build commands |
| `agents.scripts_match` | 8 | commands must exist in `package.json` scripts |
| `agents.do_dont` | 7 | explicit do/don't rules |
| `agents.map_of_important_files` | 5 | short repository map |

## npm readiness (weight 20, only when a package exists)

| Check | Weight | Fix |
| --- | --- | --- |
| `npm.metadata` | 10 | description, keywords, repository, homepage, bugs |
| `npm.keywords_quality` | 8 | 5–15 relevant keywords |
| `npm.exports` | 12 | `import` + `require` conditions |
| `npm.types` | 10 | `types` or `typesVersions` |
| `npm.side_effects` | 4 | declare only when certain |
| `npm.files_hygiene` | 8 | explicit `files`, include llms.txt/AGENTS.md |
| `npm.engines` | 4 | `engines.node` range |
| `npm.version_stability` | 5 | ≥ 1.0.0 for the npms.io completeness bonus |
| `npm.test_script` | 6 | a `test` script |
| `npm.dependency_ranges` | 5 | no `*`/`latest`/git ranges |
| `npm.config_sync` | 6 | package.json fields match `.discoverability/project.yml` |

## Docs readiness (weight 12, only when a site/homepage exists)

| Check | Weight | Fix |
| --- | --- | --- |
| `docs.llms_txt` | 20 | generate and hand-edit `llms.txt` |
| `docs.llms_full` | 8 | generate `llms-full.txt` |
| `docs.quickstart_source` | 8 | fill `quickstart.*` in the config |
| `docs.structured_data` | 10 | reviewed JSON-LD snippet |
| `docs.link_health` | 10 | probe links with `--online` |
| `docs.readme_sync` | 6 | regenerate llms.txt after README changes |

## Trust & hygiene (weight 8)

| Check | Weight | Fix |
| --- | --- | --- |
| `hygiene.license` | 15 | LICENSE file |
| `hygiene.security_policy` | 12 | SECURITY.md |
| `hygiene.contributing` | 10 | CONTRIBUTING.md |
| `hygiene.code_of_conduct` | 4 | CODE_OF_CONDUCT.md |
| `hygiene.dependabot` | 4 | `.github/dependabot.yml` with weekly updates |
| `hygiene.secrets_heuristic` | 12 | rotate + purge anything found |
| `hygiene.gitignore` | 6 | ignore build output and deps |
| `hygiene.codeowners` | 5 | .github/CODEOWNERS |
| `hygiene.citation` | 6 | CITATION.cff |
| `hygiene.issue_templates` | 5 | issue/PR templates |
| `hygiene.gitattributes` | 4 | line-ending normalisation |
