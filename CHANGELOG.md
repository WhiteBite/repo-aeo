# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-09

### Added

- Distribution channel registry backed by the committed campaign ledger
  (`.discoverability/submissions.json`), with five submission mechanisms:
  `git-pr` (curated lists), `http-json` (registry APIs), `web-form`
  (human-gated directories), `passive` (auto-crawled indexes) and
  `cli-publish` (package registries). `rdk channels` reports applicability,
  recorded status and the next action per channel.
- `rdk submit --channel <id>` runs a channel campaign: an offline preview, then
  a guarded apply (`--apply --ack --reason --plan-digest`). The `git-pr`
  channel reuses an existing open pull request instead of opening a duplicate,
  and a retry after a closed pull request drops the stale fork branch first.
- `rdk track` — the campaign dashboard. Read-only by default; `--json` emits the
  canonical `rdk-distribution/1` status, `--adopt` pulls pre-existing `rdk/*`
  pull requests into the ledger, `--sync` rewrites recorded statuses from live
  probes, and `--mark <target> --status <status>` advances one row by hand.
  Every write is guarded by an acknowledgement, a reason and a plan digest.
- Live presence verification for non-PR channels: the official MCP registry
  (server detail endpoint), the npm registry (package document) and skills.sh
  (sitemap). `git-pr` rows hydrate through `gh`, batched into a single GraphQL
  request once many rows are tracked.
- `distribution_check_submissions` returns the canonical distribution status and
  offers read-only `adopt`/`sync` previews; the MCP surface stays at nine tools
  with one guarded writer.
- `rdk-track.yml`: a weekly, read-only workflow that upserts a single
  `rdk-tracking` issue from `rdk track --json`.
- The official MCP registry submission requires the `mcpName` ownership marker
  in `package.json` and fails early with the expected value when it is absent.
- Generated `llms.txt`/`AGENTS.md` and the `docs/` set document the distribution
  contract.

### Changed

- `rdk submit` and `rdk github-sync` share one guarded write path. The ledger
  write is an upsert keyed on the channel dedupe key, so a retried submission
  replaces its own row instead of appending a duplicate.

### Removed

- Removed the unused `renderClaudeMarketplace`/`renderCodexMarketplace` exports:
  they were never wired to a generator and did not match the current Claude Code
  or Codex plugin marketplace formats.

### Security

- Listings-only, unchanged: RDK never publishes packages, images or releases and
  never tags or force-pushes. Web forms and publishes stay human-gated — the tool
  prepares the artifact and the checklist.
