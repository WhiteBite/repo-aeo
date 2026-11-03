/**
 * Axis 1 — GitHub metadata: repository description + topics.
 * Topics raise discoverability: GitHub search matches them and GitHub suggests
 * topics to repository maintainers, which pulls relevant traffic in.
 */
import { check, finding, slugifyTopic, uniq } from './_shared.js';

const DESCRIPTION_MAX = 350;

export const githubChecks = [
  check({
    id: 'github.description',
    axis: 'github',
    weight: 10,
    title: 'Repository description is present and useful',
    why: 'GitHub shows the repo description in search results, on the profile page and to crawlers. AI agents summarising a repo quote it verbatim, so a vague description directly costs you recommendations.',
    fix: 'Set a 1–2 sentence description (<=350 chars) in .discoverability/project.yml -> project.one_liner, then sync it with `rdk github-sync`.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const live = ctx.github && ctx.github.available ? ctx.github.description : null;
      const configured = ctx.config.project.one_liner || ctx.config.project.description || null;
      const description = configured || live;
      if (!description) {
        if (!ctx.github || !ctx.github.available) {
          return finding({
            id: 'github.description',
            axis: 'github',
            severity: 'info',
            title: 'Repository description not checked (offline mode)',
            why: this.why,
            fix: 'Run `rdk audit --online` to read the live description, or set project.one_liner in .discoverability/project.yml.',
            effort: 'S',
          });
        }
        return finding({
          id: 'github.description',
          axis: 'github',
          severity: 'error',
          title: 'No repository description found',
          why: this.why,
          fix: this.fix,
          effort: 'S',
        });
      }
      const text = String(description).trim();
      if (text.length > DESCRIPTION_MAX) {
        return finding({
          id: 'github.description',
          axis: 'github',
          severity: 'warn',
          title: `Repository description is too long (${text.length} chars)`,
          why: this.why,
          fix: `Shorten to <=${DESCRIPTION_MAX} characters; keep the "what it is + who it is for" claim.`,
          effort: 'S',
        });
      }
      if (text.split(/\s+/).length < 4) {
        return finding({
          id: 'github.description',
          axis: 'github',
          severity: 'warn',
          title: 'Repository description is too short to be informative',
          why: this.why,
          fix: 'Expand to 1–2 sentences: what it does, for whom, and the differentiator.',
          effort: 'S',
        });
      }
      return null;
    },
  }),

  check({
    id: 'github.topics_count',
    axis: 'github',
    weight: 12,
    title: 'Repository has useful search topics',
    why: 'Topics are an exact-match search key on GitHub and a "similar repositories" surface. A repository with zero topics is invisible there; popular repositories often run only a few, so the floor is low.',
    fix: 'Fill keywords.github_topics in .discoverability/project.yml with at least 3 and up to 20 lowercase, hyphenated terms, then run `rdk github-sync --apply`.',
    effort: 'M',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const live = ctx.github && ctx.github.available ? ctx.github.topics : [];
      const configured = Array.isArray(ctx.config.keywords.github_topics) ? ctx.config.keywords.github_topics : [];
      // GitHub topics are slugs: case variants in the config collapse onto the same live topic
      const topics = uniq([...live, ...configured].filter(Boolean).map((t) => slugifyTopic(String(t))).filter(Boolean));
      const count = topics.length;
      if (count === 0) {
        if (!ctx.github || !ctx.github.available) {
          return finding({
            id: 'github.topics_count',
            axis: 'github',
            severity: 'info',
            title: 'GitHub topics not checked (offline mode)',
            why: this.why,
            fix: 'Run `rdk audit --online` to read live topics, or fill keywords.github_topics in .discoverability/project.yml.',
            effort: 'M',
          });
        }
        return finding({
          id: 'github.topics_count',
          axis: 'github',
          severity: 'error',
          title: 'No GitHub topics configured',
          why: this.why,
          fix: this.fix,
          effort: 'M',
        });
      }
      if (count < 3) {
        return finding({
          id: 'github.topics_count',
          axis: 'github',
          severity: 'warn',
          title: `Only ${count} GitHub topics (target at least 3)`,
          why: this.why,
          fix: `Add ${3 - count} more topic(s): mix a language term, a category term and a problem term.`,
          effort: 'M',
        });
      }
      if (count > 20) {
        return finding({
          id: 'github.topics_count',
          axis: 'github',
          severity: 'warn',
          title: `${count} GitHub topics exceeds the 20 GitHub applies`,
          why: this.why,
          fix: 'Keep the 20 most specific; GitHub caps topics at 20.',
          effort: 'S',
        });
      }
      return null;
    },
  }),

  check({
    id: 'github.topics_format',
    axis: 'github',
    weight: 6,
    title: 'Topics are lowercase and hyphenated',
    why: 'GitHub normalises topics to lowercase with hyphens. Pre-normalising them in the config keeps the config, the audit and the live repository identical.',
    fix: 'Run `rdk fix` — it rewrites keywords.github_topics into canonical form.',
    effort: 'S',
    autoFixable: true,
    patchId: 'project.topics_normalize',
    run(ctx) {
      const live = ctx.github && ctx.github.available ? ctx.github.topics : [];
      const configured = Array.isArray(ctx.config.keywords.github_topics) ? ctx.config.keywords.github_topics : [];
      const raw = [...live, ...configured].filter(Boolean).map((t) => String(t));
      const invalid = raw.filter((t) => slugifyTopic(t) !== t);
      if (invalid.length > 0) {
        return finding({
          id: 'github.topics_format',
          axis: this.axis,
          severity: 'warn',
          title: `${invalid.length} topic(s) are not in canonical form: ${invalid.slice(0, 5).join(', ')}`,
          why: this.why,
          fix: `Canonical forms: ${invalid.slice(0, 5).map((t) => `${t} -> ${slugifyTopic(t)}`).join(', ')}`,
          effort: 'S',
        });
      }
      const dupes = raw.filter((t, i) => raw.indexOf(t) !== i);
      if (dupes.length > 0) {
        return finding({
          id: 'github.topics_format',
          axis: 'github',
          severity: 'info',
          title: `Duplicate topics: ${uniq(dupes).join(', ')}`,
          why: this.why,
          fix: 'Run `rdk fix` to de-duplicate.',
          effort: 'S',
        });
      }
      return null;
    },
  }),

  check({
    id: 'github.homepage',
    axis: 'github',
    weight: 6,
    title: 'Homepage URL is set',
    why: 'The homepage link is what search engines and agents follow first when they try to learn what the project is.',
    fix: 'Set links.homepage in .discoverability/project.yml (docs site or repo README anchor) and sync with `rdk github-sync`.',
    effort: 'S',
    autoFixable: false,
    patchId: null,
    run(ctx) {
      const live = ctx.github && ctx.github.available ? ctx.github.homepageUrl : null;
      const configured = ctx.config.links.homepage || null;
      if (!live && !configured) {
        return finding({
          id: 'github.homepage',
          axis: 'github',
          severity: 'warn',
          title: 'No homepage URL configured',
          why: this.why,
          fix: this.fix,
          effort: 'S',
        });
      }
      return null;
    },
  }),
];
