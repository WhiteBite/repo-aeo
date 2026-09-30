# GEO/AEO playbook for repositories

Why these specific moves, and what they are worth.

## Two channels of AI recommendation

1. **Training priors** — what the model memorised. Influenced only slowly, by
   long-term presence on the web.
2. **Live retrieval / grounding** — what the model (or its search tool) reads at
   answer time. Influenced **immediately** by how digestible your metadata is.

RDK targets channel 2 first, and channel 1 through the same artifacts (a clean,
linked, citable repository is what gets scraped, quoted and re-published).

## What moves the needle

| Move | Mechanism | Effort |
| --- | --- | --- |
| README first success path | an agent summarising the repo quotes the top of the README | S |
| 2–5 concrete examples | examples are what get copied into answers | M |
| Numbers with named sources | verifiable statistics survive summarisation and are quoted more often | M |
| GitHub topics (8–20) | GitHub search key + "similar repositories" surface | S |
| npm description + keywords | registry search ranking signal | S |
| `exports` + `types` | broken installs remove the package from consideration | M |
| `AGENTS.md` with real commands | agents that can run tests produce correct patches | S |
| `llms.txt` / `llms-full.txt` | one small fetch replaces parsing hundreds of KB of HTML | S |
| `CITATION.cff` | one-click citation from the GitHub UI | S |
| LICENSE / SECURITY / CONTRIBUTING | trust signals for humans and for scoring APIs | S |

## What does not work

- Keyword stuffing beyond ~20 topics or ~15 npm keywords: diluted signal,
  spam-like appearance.
- Claims without sources: contradicted by the first reader who checks.
- Fully LLM-generated `AGENTS.md` shipped unreviewed: research on generated
  instruction files shows reduced task success and higher cost. Draft, then
  have a human edit.
- Publishing/tagging from an automation without an explicit ACK.

## Measuring success

Fast, tool-controlled proxies:

- npm quality / popularity / maintenance score (npms.io weights: 0.3 / 0.35 /
  0.35, with a completeness bonus at ≥ 1.0.0, not deprecated, < 15 open issues,
  README and tests present).
- llms.txt / AGENTS.md presence and freshness.
- Open issue count, release freshness.
- GitHub topic coverage and README structure score.
- Served docs sites: add `<link rel="alternate" type="text/plain" href="/llms.txt">`
  (and `rel="describedby"` for llms-full.txt) to the HTML head — the llms.txt v2
  discovery mechanism for crawlers and agents that fetch sites, per the spec.

Slow, manual, quarterly: ask ChatGPT/Claude/Perplexity "best library for X" and
check whether the project is mentioned. Treat it as a checkpoint, not a KPI.
