# Distribution playbook (curated lists)

How to get a project listed where its audience already searches: awesome
lists, catalogs and other curated collections. Load this reference before
proposing the project to any repository you do not own.

## The one platform constraint

A pull request head must live in a fork of the target repository — GitHub
compares only inside a fork network, so **one fork per target** is the
minimum. The clutter is still avoidable: forks are disposable. Create them
just-in-time over the API, never clone them, delete them after the PR is
merged or closed. While a PR is open its fork must stay alive: deleting the
fork closes the PR, and re-forking does not re-link it (the PR binds to the
fork's internal id, not its name).

## Choose targets

| Signal | Query |
| --- | --- |
| Lists for the ecosystem | `gh search repos --topic=awesome-nodejs --sort=stars` |
| Lists by keyword | `gh search repos "awesome static site"` |
| Harness/tool lists | topic of the project + `awesome-` prefix |
| Registries | topic-specific (MCP directories, action marketplaces, plugin lists) |

A target qualifies only when: the project fits the list's declared scope
(tangential is a rejection), the list is maintained (commits within ~6
months, open PRs get reviews), and it does not already list the project —
search the README for the project name before anything else.

## Read the list's own rules before editing

Curated lists have a `CONTRIBUTING.md` and often a PR template; the template
text is the maintainer's actual checklist. Recurring rules:

| Convention | Typical value |
| --- | --- |
| PR title | `Add <Project>` — never "Added", "Adding", "Update readme" |
| Entry position | alphabetical inside the category (awesome-go) or at the category bottom (sindresorhus/awesome) |
| Entry format | `- [Name](repo-url) — Objective one-line description.` |
| Description tone | objective, ends with a period, no marketing, no emoji, no "awesome" |
| Maturity gates | age, license, releases, tests (awesome-go: 5 months of history, SemVer release) |
| Scope | one item per PR — never bundle several additions |

Breaking the local entry format is the most common rejection reason.

## Craft the entry from the project config

Generate from `.discoverability/project.yml` so the campaign cannot drift
from the source of truth: the name from the package/project name, the URL
from `links.repository`, the description line from the project `description`
(ends with a period, objective — not the tagline). Test: the line must
survive a maintainer who has never heard of the project.

### Write a strong entry

Curated lists reject marketing language on sight — their whole value is
objective curation ("Do not use marketing language. 'AI visibility
monitoring for ChatGPT and Perplexity' is an entry; 'the leading AI
visibility platform' is not." — elmohq's contributing guide; awesome-go and
sindresorhus/awesome say the same). A superlative ("one of the best") gets
the PR closed unread. It also fails our own audit, which flags unsourced
claims.

The entry is a doorway, not a billboard: the reader clicks through and
decides on the repository itself. The line's job is to describe precisely
and to carry one verifiable fact the section's neighbours do not have —
a number, a constraint, a capability. Adjectives are not verifiable.

| Entry | Verdict | Why |
| --- | --- | --- |
| `- [X](url) - One of the best discoverability tools.` | rejected | unverifiable superlative, marketing tone |
| `- [X](url) - Tool for repo discoverability.` | forgettable | says nothing a hundred other entries don't |
| `- [X](url) - Zero-dependency CLI that audits and fixes repo discoverability: 44 checks offline, llms.txt and AGENTS.md generation, CI gate.` | strong | function + checkable facts + traits the neighbours lack |

A battle-tested example (accepted by the elmohq AEO list):

```markdown
- [repo-aeo](https://github.com/WhiteBite/repo-aeo) - **Open source.** Make any
  repository, npm package and docs site findable and recommendable to humans,
  AI agents and search engines.
```

Craft order: start from `project.yml`'s one-liner, then scan the target
section's neighbours, then sharpen the line until it answers "why this one"
with a fact instead of an adjective. Local list conventions (marker prefixes
like `**Open source.**`, dash style, sort order) always win over this guide.

## Mechanics: one local repo, many targets

The kit automates the whole loop:

```bash
npx repo-aeo submit --search                                  # list candidates (gh)
npx repo-aeo submit --targets owner/list --category "Tools" \
  --position alphabetical                                     # preview: entry, branch, PR
# then, after human review of the preview:
npx repo-aeo submit --apply --ack <ACK> --reason "why" \
  --plan-digest <DIGEST> --targets owner/list --category "Tools" --position alphabetical
```

`submit` forks each target just-in-time, inserts the entry into the named
section (end or alphabetical), pushes a `rdk/<list>/add-<project>` branch to
the fork, opens the PR and records it in `.discoverability/submissions.json`.
A target that already has a recorded submission is skipped automatically.

For targets the command cannot handle (a data file instead of README, a
different entry format), fall back to the manual loop below — it is also what
`submit` does per target. One local repository can hold every target as a
remote; git keeps unrelated histories side by side, and shallow fetches keep
it small. One fork per target is created over the API when the PR is
submitted, never cloned.

```bash
# once per target: register the upstream (fetch-only)
git remote add awesome-kiro https://github.com/kirodotdev-labs/awesome-kiro.git

# per submission
git fetch --depth=1 awesome-kiro main
git switch -c rdk/awesome-kiro/add-myproject awesome-kiro/main
# edit README.md per the list's own conventions, commit
gh repo fork kirodotdev-labs/awesome-kiro --clone=false   # reuse if it exists
git push https://github.com/WhiteBite/awesome-kiro.git rdk/awesome-kiro/add-myproject
gh pr create -R kirodotdev-labs/awesome-kiro \
  --head WhiteBite:rdk/awesome-kiro/add-myproject \
  --title "Add myproject" --body-file pr-body.md
```

Branch names are namespaced by target (`rdk/<list>/<topic>`) so a campaign
never collides with itself.

## When gh is not installed

`rdk submit` previews offline but needs gh for `--search` and for opening
PRs; the manual fallback works without it:

- **Fork**: the target's web "Fork" button, or
  `POST /repos/{owner}/{repo}/forks` with a token.
- **Push**: plain `git push` to the fork URL over HTTPS.
- **PR**: open the compare URL directly —
  `https://github.com/<owner>/<list>/compare/main...<user>:<branch>` —
  which lands on a prefilled PR form.
- **Status**: `repo-aeo-mcp submissions` without `--live` reports the
  recorded state from `submissions.json`; nothing else in the kit requires
  gh on the submission path.

## Fork hygiene

- After a PR merges or is closed with no retry: delete the fork
  (`gh repo delete <owner>/<list> --yes`; grant the scope once with
  `gh auth refresh -h github.com -s delete_repo`). Contributions and merged
  commits stay on the upstream and the profile.
- The steady state of an account running many campaigns is zero forks.
- Prefer issue submissions where the list's CONTRIBUTING allows it — no
  fork at all.
- Forks of still-open PRs must survive until the PR is resolved.

## Track the campaign

`.discoverability/submissions.json` (committed, unlike `cache/`) is the
campaign ledger; every submission is appended before the PR is opened:

```json
[
  {
    "target": "kirodotdev-labs/awesome-kiro",
    "pr_url": "https://github.com/kirodotdev-labs/awesome-kiro/pull/123",
    "branch": "rdk/awesome-kiro/add-myproject",
    "fork": "WhiteBite/awesome-kiro",
    "submitted_at": "2026-10-03T09:00:00Z",
    "status": "open"
  }
]
```

Check it before choosing targets — submitting to a list that already has an
open PR for the project is spam. Read the state back with:

```bash
npx repo-aeo-mcp submissions          # recorded state, offline
npx repo-aeo-mcp submissions --live   # probe PR states via gh
```

`--live` needs gh; without it the tool reports the recorded statuses.

## Safety rails

- Never open a PR in a repository you do not own without showing the human
  the target list, the exact entry and the fork plan, and getting an
  explicit ACK. One ACK per campaign batch is not one ACK per target.
- Pace the campaign: a burst of same-looking PRs across dozens of lists
  looks like spam to maintainers and to GitHub.
- Never re-submit to a list that closed a PR — the closing comment is the
  requirement list for the next attempt, months later, if the project
  changed enough.
- Record every submission in `submissions.json` at submit time.

## What gets PRs rejected

- Marketing tone ("blazingly fast", "the best") in the description.
- Wrong category or wrong position (not alphabetical where required).
- One PR adding several items.
- A project that is days old, without a license, description or README —
  lists gate on maturity; a low RDK audit score predicts the rejection.
- Duplicates: not searching the list first.
