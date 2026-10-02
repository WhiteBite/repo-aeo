import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseMarkdown, isSkip } from '../src/audit/checks/_shared.js';
import { readmeChecks } from '../src/audit/checks/readme.js';
import { npmChecks } from '../src/audit/checks/npm.js';
import { hygieneChecks } from '../src/audit/checks/hygiene.js';
import { githubChecks } from '../src/audit/checks/github.js';
import { agentsChecks } from '../src/audit/checks/agents.js';
import { docsChecks } from '../src/audit/checks/docs.js';
import { makeRepo, removeRepo } from './helpers.js';

const readmeCheck = (id) => readmeChecks.find((c) => c.id === id);
const npmCheck = (id) => npmChecks.find((c) => c.id === id);
const hygieneCheck = (id) => hygieneChecks.find((c) => c.id === id);

const SETEXT_README = [
  'demo-widget',
  '===========',
  '',
  'Who is it for',
  '--------------',
  '',
  'Maintainers publishing an npm package.',
  '',
  'Use cases',
  '---------',
  '',
  'Scoring a repository.',
  '',
  'Why choose this',
  '---------------',
  '',
  'One config file.',
  '',
  'Status',
  '------',
  '',
  'Actively developed.',
].join('\n');

test('setext headings are parsed and satisfy readme.audience_sections', () => {
  const doc = parseMarkdown(SETEXT_README);
  assert.deepEqual(
    doc.headings.map((h) => [h.level, h.text]),
    [
      [1, 'demo-widget'],
      [2, 'Who is it for'],
      [2, 'Use cases'],
      [2, 'Why choose this'],
      [2, 'Status'],
    ],
  );
  const dir = makeRepo({ 'README.md': SETEXT_README });
  try {
    assert.equal(readmeCheck('readme.audience_sections').run({ cwd: dir }), null);
    assert.equal(readmeCheck('readme.heading_structure').run({ cwd: dir }), null);
  } finally {
    removeRepo(dir);
  }
});

test('setext underline after a blank line or heading is not a heading', () => {
  const doc = parseMarkdown(['# Real', '', '---', '', 'Paragraph', '---'].join('\n'));
  assert.deepEqual(
    doc.headings.map((h) => [h.level, h.text]),
    [
      [1, 'Real'],
      [2, 'Paragraph'],
    ],
  );
});

test('HTML heading tags are parsed case-insensitively with inner tags stripped', () => {
  const doc = parseMarkdown('<h1>demo-widget</h1>\n\n<h2>Who is it for</h2>\n\n<H3>Case</H3>\n\n<h2 id="aud">Use <em>cases</em></h2>\n');
  assert.deepEqual(
    doc.headings.map((h) => [h.level, h.text]),
    [
      [1, 'demo-widget'],
      [2, 'Who is it for'],
      [3, 'Case'],
      [2, 'Use cases'],
    ],
  );
});

test('README with HTML headings satisfies readme.audience_sections', () => {
  const readme = [
    '<h1>demo-widget</h1>',
    '',
    '<h2>Who is it for</h2>',
    '',
    'Maintainers.',
    '',
    '<h2>Use cases</h2>',
    '',
    'Scoring.',
    '',
    '<h2>Why choose this</h2>',
    '',
    'One config.',
    '',
    '<h2>Status</h2>',
    '',
    'Active.',
  ].join('\n');
  const dir = makeRepo({ 'README.md': readme });
  try {
    assert.equal(readmeCheck('readme.audience_sections').run({ cwd: dir }), null);
  } finally {
    removeRepo(dir);
  }
});

test('setext underlines and HTML tags inside code fences are not headings', () => {
  const doc = parseMarkdown(['# Real', '', '```text', '---', '===', '<h2>nope</h2>', '```', '', 'After', '---'].join('\n'));
  assert.deepEqual(
    doc.headings.map((h) => [h.level, h.text]),
    [
      [1, 'Real'],
      [2, 'After'],
    ],
  );
  assert.equal(doc.codeBlocks.length, 1);
});

test('a deprecated field in the source package.json is not a registry deprecation', () => {
  const check = npmCheck('npm.version_stability');
  assert.equal(check.run({ pkg: { name: 'x', version: '2.0.0', deprecated: 'use y instead' } }), null);
  const pre = check.run({ pkg: { name: 'x', version: '0.9.0', deprecated: 'use y instead' } });
  assert.equal(pre.severity, 'info');
  assert.match(pre.title, /pre-1\.0/);
});

test('an array exports map (file-list form) passes the exports check', () => {
  const check = npmCheck('npm.exports');
  assert.equal(check.run({ pkg: { name: 'x', exports: ['./dist/a.js', './dist/b.js'] } }), null);
  const objectMap = check.run({ pkg: { name: 'x', exports: { '.': { require: './dist/cjs.js' } } } });
  assert.equal(objectMap.severity, 'error');
  assert.match(objectMap.title, /"import"/);
});

test('a malformed percent-encoded link is a broken link, not a crash', () => {
  const dir = makeRepo({ 'README.md': '# t\n\nSee [bad](./%E0%A4%A) and [good](./README.md).\n' });
  try {
    const result = readmeCheck('readme.local_links').run({ cwd: dir });
    assert.ok(result, 'expected a broken-link finding');
    assert.equal(result.severity, 'warn');
    assert.match(result.title, /1 broken relative link/);
    assert.match(result.fix, /%E0%A4%A/);
  } finally {
    removeRepo(dir);
  }
});

test('gitignore entries without a trailing slash satisfy hygiene.gitignore', () => {
  const check = hygieneCheck('hygiene.gitignore');
  const dir = makeRepo({ '.gitignore': 'node_modules\ndist\n' });
  try {
    assert.equal(check.run({ cwd: dir }), null);
  } finally {
    removeRepo(dir);
  }
  const partial = makeRepo({ '.gitignore': 'node_modules\n' });
  try {
    const result = check.run({ cwd: partial });
    assert.ok(result, 'expected a finding for the missing dist entry');
    assert.match(result.title, /dist/);
    assert.doesNotMatch(result.title, /node_modules/);
  } finally {
    removeRepo(partial);
  }
});

test('topics_count fix text stays coherent with topics_format when both fire', () => {
  const check = githubChecks.find((c) => c.id === 'github.topics_count');
  const ctx = {
    config: { keywords: { github_topics: ['Bad Topic', 'ok-topic'] } },
    github: { available: false, reason: 'offline', description: null, topics: [], homepageUrl: null },
  };
  const result = check.run(ctx);
  assert.equal(result.severity, 'warn');
  // canonical forms count toward the total, so the count advice stays plain
  assert.doesNotMatch(result.fix, /non-canonical/);
  assert.match(result.fix, /Add 6 more topics/);
  const clean = check.run({
    config: { keywords: { github_topics: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] } },
    github: { available: false, reason: 'offline', description: null, topics: [], homepageUrl: null },
  });
  assert.equal(clean, null);
});

test('finding() calls inherit declaration fields instead of duplicating literals', () => {
  const checksDir = new URL('../src/audit/checks/', import.meta.url);
  for (const file of readdirSync(checksDir).filter((name) => name.endsWith('.js') && name !== '_shared.js')) {
    const src = readFileSync(new URL(file, checksDir), 'utf8');
    const re = /finding\(\s*\{/g;
    let match;
    while ((match = re.exec(src)) !== null) {
      let depth = 1;
      let end = re.lastIndex;
      while (depth > 0 && end < src.length) {
        if (src[end] === '{') depth += 1;
        else if (src[end] === '}') depth -= 1;
        end += 1;
      }
      const body = src.slice(match.index, end);
      assert.doesNotMatch(body, /autoFixable:\s*(?:true|false)\b/, `${file}: static autoFixable duplicates the declaration and can drift; omit it`);
      assert.doesNotMatch(body, /patchId:\s*(?:'[^']*'|null)\s*[,}]/, `${file}: static patchId duplicates the declaration and can drift; omit it`);
      assert.doesNotMatch(body, /weight:\s*this\.weight/, `${file}: weight is inherited from the declaration; omit it`);
    }
  }
});

test('findings from a sample run of every check carry numeric weights', () => {
  const pkg = { name: 'demo', version: '0.1.0', main: 'index.js' };
  const dir = makeRepo({
    'README.md': '# demo\n\n'.padEnd(300, 'x'),
    'package.json': JSON.stringify(pkg),
    '.gitignore': 'node_modules\n',
  });
  try {
    const ctx = {
      cwd: dir,
      options: {},
      config: {
        project: { category: 'tool' },
        keywords: { github_topics: ['Bad Topic', 'ok-topic'] },
        links: { homepage: 'https://example.com' },
        quickstart: {},
      },
      pkg,
      github: { available: false, reason: 'offline', description: null, topics: [], homepageUrl: null },
      online: null,
    };
    const all = [...githubChecks, ...readmeChecks, ...agentsChecks, ...npmChecks, ...docsChecks, ...hygieneChecks];
    let findings = 0;
    for (const definition of all) {
      const result = definition.run(ctx);
      if (isSkip(result) || result === null || result === undefined) continue;
      findings += 1;
      assert.equal(typeof result.weight, 'number', `${definition.id} produced a finding without a numeric weight`);
    }
    assert.ok(findings > 20, `expected a broad sample of findings, got ${findings}`);
  } finally {
    removeRepo(dir);
  }
});
