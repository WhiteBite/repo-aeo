# Configuration reference: `.discoverability/project.yml`

The config is the single source of truth. Every generator, check and sync
command reads it. Create it with `npx repo-aeo init` (seeded from `package.json` and
the git remote) or copy the annotated template from `rdk init --dry-run`.

## `schema_version`

Config schema revision. Currently `1`. `rdk` warns when a config file carries
any other value and continues with best-effort defaults.

## `project`

| Field | Meaning |
| --- | --- |
| `name` | project name; defaults to `package.json` `name` |
| `one_liner` | one sentence; used as the GitHub description and the llms.txt summary |
| `description` | longer paragraph for README/npm `description` |
| `category` | `library` · `app` · `template` · `research` · `tool` · `dataset` · `mcp-server` |
| `copyright_holder` | name on the LICENSE copyright line and the JSON-LD `author`; `rdk init` seeds it from the git owner |

## `audiences`

List of who the project is for. Feeds the README "Who is it for" section and the
audience-matching part of agent retrieval.

## `use_cases`

3–7 concrete jobs the project does. Feeds the README "Use cases" section and the
"Key facts" block of `llms.txt`.

## `keywords`

| Field | Meaning |
| --- | --- |
| `github_topics` | 8–20 terms, lowercase with hyphens; pushed by `rdk github-sync` |
| `npm_keywords` | 5–15 terms merged into `package.json` `keywords` by `rdk fix` |

## `links`

| Field | Meaning |
| --- | --- |
| `homepage` | project homepage; also the GitHub homepage URL |
| `docs` | documentation URL; enables the docs axis |
| `demo` | demo URL (optional) |
| `issues` | issue tracker; seeds `package.json` `bugs` and the repository URL |

## `quickstart`

| Field | Meaning |
| --- | --- |
| `prerequisites` | runtimes and versions, e.g. `Node.js >= 18` |
| `install` | the install command |
| `run` | the run command |
| `test` | the test command |

These four values generate the README Quickstart, the `AGENTS.md` command block
and the "Key facts" section of `llms.txt`. Empty values produce hollow docs, so
the audit flags them.

## `artifacts`

| Field | Meaning |
| --- | --- |
| `has_npm_package` | enables the npm axis (also implied by the presence of `package.json`) |
| `has_docs_site` | enables the docs axis (also implied by `links.homepage`/`links.docs`) |
| `npm_published` | gates the npm registry `sameAs` in the generated JSON-LD; set to `true` only after the package actually lands on the registry |

When `has_docs_site: false` while `links.homepage` or `links.docs` is set,
`rdk` emits the `config.docs_site_overridden` warning: the links imply a docs
presence, so the docs axis stays enabled.

## `differentiators`

"Why this repo, not the alternatives." 2–4 bullets, ideally with numbers and
named sources. Feeds the README "Why choose this" section.

## `safety`

| Field | Default | Meaning |
| --- | --- | --- |
| `allow_autofix` | `false` | when `true`, the Action may open an autofix pull request |
| `require_ack_for_publish` | `true` | publish/tag/release always require an explicit human ACK |
| `ack` | `null` | server-configured acknowledgement override for `github-sync`; a non-empty string replaces the default ACK constant, `null`/absent keeps it |

## Distribution state is not config

The distribution campaign (`rdk channels`, `submit`, `track`) adds no keys to
`project.yml`. The config decides *what* the artifact is; where it was
submitted and how it is doing lives in the committed ledger
`.discoverability/submissions.json` (schema `rdk-distribution/1`), and live
probe snapshots live in the git-ignored `.discoverability/cache/`. Ledger
writes go through the same guard chain as `github-sync`:
`--apply --ack <ACK> --reason "<why>" --plan-digest <DIGEST>`. See
[`architecture.md`](./architecture.md) for the tracking model.

## Safety model

| Operation | Requirement |
| --- | --- |
| `rdk audit` | none (read-only, offline) |
| `rdk fix` | `--apply` (dry-run by default) |
| `rdk init` | `--apply` |
| `rdk github-sync` | `--apply --ack <ACK> --reason "<why>"` |
| `npm publish` / `git tag` / release | never performed by RDK |

The ACK string for this repository is `I_ACK_RDK_GITHUB_WRITE`
(`DEFAULT_ACK` in `src/commands/githubSync.js`); the reason is required so every
repository write is auditable. A non-empty `safety.ack` overrides that constant
(for server-configured deployments); the default constant stays
`I_ACK_RDK_GITHUB_WRITE` when it is `null` or absent.
