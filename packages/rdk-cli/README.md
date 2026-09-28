# @repo-aeo/rdk-cli

Audit and improve repository discoverability: GitHub metadata and topics, README
structure, `AGENTS.md`, the npm publish surface, `llms.txt` and structured data.

Zero runtime dependencies. Node >= 18. Read-only by default.

## Install

```bash
npm install --save-dev @repo-aeo/rdk-cli
npx rdk --help
```

## Commands

| Command | What it does | Writes? |
| --- | --- | --- |
| `rdk init` | scaffolds `.discoverability/project.yml` and the minimal safe files | with `--apply` |
| `rdk audit` | Discoverability Score 0–100 + findings with severity/why/fix/effort | never |
| `rdk fix` | applies only safe, idempotent autofixes | with `--apply` |
| `rdk npm-surface` | package.json publish surface + `npm pack --dry-run` hygiene | never |
| `rdk github-sync` | pushes description/homepage/topics to GitHub | with `--apply --ack --reason` |

## Output formats

```bash
npx rdk audit --format json             # machine readable (stdout is pure JSON)
npx rdk audit --format markdown         # full human report
npx rdk audit --format github-comment   # compact PR comment (marker: <!-- rdk-discoverability-audit -->)
npx rdk audit --out report.md           # also write to a file
```

## Safety model

- `audit` is read-only and offline by default; `--online` adds link checks and
  GitHub API reads.
- `fix`/`init` are dry-run by default and write only with `--apply`.
- `github-sync` requires `--apply --ack <ACK> --reason "<why>"`.
- Nothing in this package publishes, tags, releases or force-pushes.

## Programmatic use

```js
import { audit, planPatches, renderGithubComment } from '@repo-aeo/rdk-cli';

const report = await audit(process.cwd(), { online: false });
console.log(report.score.total, report.findings.length);
console.log(renderGithubComment(report));
```

## Development

```bash
npm test        # node --test
node bin/rdk.js audit --online
```
