import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  GENERATED_START,
  GENERATED_END,
  HANDWRITTEN_NOTE,
  mergeGenerated,
  renderCodeowners,
  renderCitationCff,
  citationRepositoryRefresh,
  renderProjectYml,
  renderReadme,
  renderAgentsMd,
  renderLlmsTxt,
  renderJsonLd,
  renderSecurityMd,
} from '../src/generate/index.js';
import { parse } from '../src/yaml.js';
import { makeRepo, removeRepo } from './helpers.js';
import { loadConfig, CONFIG_RELATIVE_PATH } from '../src/config.js';
import { planPatches, applyPatches } from '../src/fix/patches.js';

const FULL_CONFIG = {
  schema_version: 1,
  project: { name: 'round-trip', one_liner: 'It round-trips', description: 'Longer text', category: 'tool', copyright_holder: 'Round Trip Authors' },
  audiences: ['devs'],
  use_cases: ['one', 'two'],
  keywords: { github_topics: ['cli', 'developer-tools'], npm_keywords: ['cli'] },
  links: { homepage: 'https://example.com', docs: null, demo: null, issues: 'https://github.com/o/r/issues' },
  quickstart: { prerequisites: ['Node.js >= 18'], install: 'npm i round-trip', run: 'npm start', test: 'npm test' },
  artifacts: { has_npm_package: true, has_docs_site: false, npm_published: false },
  differentiators: ['because'],
  safety: { allow_autofix: false, require_ack_for_publish: true, ack: null },
};

function contextFor(dir) {
  const loaded = loadConfig(dir);
  return {
    cwd: dir,
    options: {},
    config: loaded.config,
    configExists: loaded.exists,
    pkg: loaded.publishable.pkg,
    publishable: loaded.publishable,
    git: loaded.git,
  };
}

test('renderProjectYml output round-trips through the YAML parser', () => {
  const parsed = parse(renderProjectYml(FULL_CONFIG));
  assert.deepEqual(parsed, FULL_CONFIG);
});

test('renderProjectYml emits schema_version as the first key', () => {
  const yml = renderProjectYml(FULL_CONFIG);
  const firstKey = yml.split('\n').find((line) => /^[a-z_]+:/.test(line));
  assert.ok(firstKey.startsWith('schema_version: 1'), `first key is not schema_version: ${firstKey}`);
});

test('renderProjectYml handles empty lists', () => {
  const parsed = parse(renderProjectYml({ project: { name: 'x' }, keywords: {} }));
  assert.deepEqual(parsed.audiences, []);
  assert.deepEqual(parsed.keywords.github_topics, []);
});

test('mergeGenerated keeps CRLF files CRLF inside the regenerated block', () => {
  const crlf = `head\r\n${GENERATED_START}\r\nOLD BODY\r\n${GENERATED_END}\r\ntail\r\n`;
  const merged = mergeGenerated(crlf, 'NEW BODY\nsecond line');
  assert.ok(merged.includes('NEW BODY\r\nsecond line'));
  assert.equal(merged.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(mergeGenerated(merged, 'NEW BODY\nsecond line'), merged);
});

test('mergeGenerated wraps new files and preserves hand-written tails', () => {
  const first = mergeGenerated(null, 'GENERATED BODY');
  assert.ok(first.includes(GENERATED_START));
  assert.ok(first.includes(GENERATED_END));

  const handEdited = `${first}\nMy own paragraph that must survive.\n`;
  const merged = mergeGenerated(handEdited, 'NEW GENERATED BODY');
  assert.ok(merged.includes('NEW GENERATED BODY'));
  assert.ok(merged.includes('My own paragraph that must survive.'));

  // legacy files without markers are never silently overwritten
  assert.equal(mergeGenerated('some hand written file', 'GENERATED BODY'), null);
});

test('mergeGenerated collapses duplicated marker spans into one fresh block', () => {
  const duplicated = `head\n${GENERATED_START}\nSTALE ONE\n${GENERATED_END} ${GENERATED_START}\nSTALE TWO\n${GENERATED_END}\ntail\n`;
  const merged = mergeGenerated(duplicated, 'FRESH');
  assert.equal(merged.split(GENERATED_START).length - 1, 1);
  assert.equal(merged.split(GENERATED_END).length - 1, 1);
  assert.ok(merged.startsWith(`head\n${GENERATED_START}\n`));
  assert.ok(merged.endsWith(`${GENERATED_END}\ntail\n`));
  assert.ok(!merged.includes('STALE'));
  assert.equal(mergeGenerated(merged, 'FRESH'), merged);
});

test('mergeGenerated preserves manual content between duplicated spans', () => {
  const duplicated = `${GENERATED_START}\nOLD\n${GENERATED_END}\nmanual note\n${GENERATED_START}\nOLD2\n${GENERATED_END}\n\n## Hand-written notes\n\nkeep\n`;
  const merged = mergeGenerated(duplicated, 'FRESH');
  assert.equal(merged.split(GENERATED_START).length - 1, 1);
  assert.equal(merged.split(GENERATED_END).length - 1, 1);
  assert.ok(!merged.includes('OLD'));
  assert.ok(merged.includes('manual note'));
  assert.ok(merged.includes('## Hand-written notes'));
  assert.ok(merged.includes('keep'));
  assert.ok(merged.indexOf('manual note') < merged.indexOf('## Hand-written notes'));
  assert.equal(mergeGenerated(merged, 'FRESH'), merged);
});

test('mergeGenerated heals an orphan start marker, dropping the stale body at the heading', () => {
  const orphan = `${GENERATED_START}\nSTALE BODY\n\n## Hand-written notes\n\n${HANDWRITTEN_NOTE}\nmanual survives\n`;
  const merged = mergeGenerated(orphan, 'FRESH');
  assert.equal(merged.split(GENERATED_START).length - 1, 1);
  assert.equal(merged.split(GENERATED_END).length - 1, 1);
  assert.ok(!merged.includes('STALE BODY'));
  assert.ok(merged.includes('## Hand-written notes'));
  assert.ok(merged.includes('manual survives'));
  assert.equal(mergeGenerated(merged, 'FRESH'), merged);
});

test('mergeGenerated heals an orphan start marker without a heading, losing nothing', () => {
  const orphan = `head\n${GENERATED_START}\nold body\nmanual tail\n`;
  const merged = mergeGenerated(orphan, 'FRESH');
  assert.equal(merged.split(GENERATED_START).length - 1, 1);
  assert.equal(merged.split(GENERATED_END).length - 1, 1);
  assert.ok(merged.includes('old body'));
  assert.ok(merged.includes('manual tail'));
  assert.equal(mergeGenerated(merged, 'FRESH'), merged);
});

test('mergeGenerated heals an orphan end marker without losing content', () => {
  const orphan = `old body\n${GENERATED_END}\n\n## Hand-written notes\n\nkeep\n`;
  const merged = mergeGenerated(orphan, 'FRESH');
  assert.equal(merged.split(GENERATED_START).length - 1, 1);
  assert.equal(merged.split(GENERATED_END).length - 1, 1);
  assert.ok(merged.includes('old body'));
  assert.ok(merged.includes('## Hand-written notes'));
  assert.ok(merged.includes('keep'));
  assert.equal(mergeGenerated(merged, 'FRESH'), merged);
});

test('mergeGenerated healing keeps CRLF files CRLF', () => {
  const duplicated = `head\r\n${GENERATED_START}\r\nOLD\r\n${GENERATED_END}\r\n${GENERATED_START}\r\nOLD2\r\n${GENERATED_END}\r\ntail\r\n`;
  const merged = mergeGenerated(duplicated, 'FRESH\nLINE');
  assert.equal(merged.split(GENERATED_START).length - 1, 1);
  assert.ok(merged.includes('FRESH\r\nLINE'));
  assert.equal(merged.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(mergeGenerated(merged, 'FRESH\nLINE'), merged);
});

test('rdk fix does not clobber a hand-edited llms.txt', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'keep-mine', description: 'Keep mine' }) });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    const llmsPath = join(dir, 'llms.txt');
    writeFileSync(llmsPath, '# my own llms.txt\n\nhand written, no markers\n', 'utf8');
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    assert.equal(readFileSync(llmsPath, 'utf8'), '# my own llms.txt\n\nhand written, no markers\n');
  } finally {
    removeRepo(dir);
  }
});

test('rdk fix heals a corrupted llms.txt with duplicated marker spans', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'heal-me', description: 'Heal me' }) });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    const llmsPath = join(dir, 'llms.txt');
    writeFileSync(llmsPath, `${GENERATED_START}\nSTALE\n${GENERATED_END}${GENERATED_START}\nSTALE2\n${GENERATED_END}\n\n## Hand-written notes\n\nmanual\n`, 'utf8');
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    const healed = readFileSync(llmsPath, 'utf8');
    assert.equal(healed.split(GENERATED_START).length - 1, 1);
    assert.equal(healed.split(GENERATED_END).length - 1, 1);
    assert.ok(!healed.includes('STALE'));
    assert.ok(healed.includes('manual'));
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    assert.equal(readFileSync(llmsPath, 'utf8'), healed);
  } finally {
    removeRepo(dir);
  }
});

test('generated README links only to URLs that exist in the config', () => {
  const readme = renderReadme({ project: { name: 'links-check', one_liner: 'Check the links' }, links: {} });
  const urls = [...readme.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(urls, []);
});

test('renderReadme renders only commands the package actually has', () => {
  const readme = renderReadme({ project: { name: 'no-scripts', one_liner: 'No scripts' } }, { name: 'no-scripts' });
  assert.match(readme, /npm install no-scripts/);
  assert.doesNotMatch(readme, /npm (start|test|start --help)/);
  assert.doesNotMatch(readme, /Run the tests:/);
});

test('renderReadme omits the Quickstart section when no real command exists', () => {
  const readme = renderReadme({ project: { name: 'nothing-real' } }, null);
  assert.doesNotMatch(readme, /## Quickstart/);
  assert.doesNotMatch(readme, /```bash/);
});

test('renderAgentsMd omits the commands block when nothing real exists', () => {
  const agents = renderAgentsMd({ project: { name: 'no-scripts' } }, { name: 'no-scripts' });
  assert.doesNotMatch(agents, /```bash/);
  assert.doesNotMatch(agents, /npm (start|test)/);
});

test('renderAgentsMd header omits the separator when no one_liner or description exists', () => {
  const bare = renderAgentsMd({ project: { name: 'my-lib' } }, null);
  assert.match(bare, /^Project: my-lib$/m);
  assert.doesNotMatch(bare, /Project: my-lib —/);

  const withDescription = renderAgentsMd({ project: { name: 'd-lib', description: 'Does things' } }, null);
  assert.match(withDescription, /^Project: d-lib — Does things$/m);

  const withOneLiner = renderAgentsMd({ project: { name: 'o-lib', one_liner: 'One line' } }, null);
  assert.match(withOneLiner, /^Project: o-lib — One line$/m);
});

test('renderLlmsTxt omits the Key facts section when the config has none', () => {
  const llms = renderLlmsTxt({ project: { name: 'bare-facts', one_liner: 'Bare' } }, null, '# bare-facts\n');
  assert.doesNotMatch(llms, /## Key facts/);
  assert.match(llms, /## Optional/);

  const withFacts = renderLlmsTxt({ project: { name: 'facts', one_liner: 'Facts' }, quickstart: { install: 'npm i facts' }, use_cases: ['a'] }, null, '# facts\n');
  assert.match(withFacts, /## Key facts\n\n- Install: `npm i facts`\n- Use cases: a\n/);
});

test('renderLlmsTxt omits Key facts when quickstart values and use_cases are present but empty', () => {
  const llms = renderLlmsTxt(
    { project: { name: 'zero-facts', one_liner: 'Zero' }, quickstart: { install: '', run: '', test: '' }, use_cases: [] },
    null,
    '# zero-facts\n',
  );
  assert.doesNotMatch(llms, /## Key facts/);
  assert.match(llms, /## Optional/);
});

test('generated CODEOWNERS names the audited repository owner, not ours', () => {
  // Regression: renderCodeowners() used to hard-code `* @WhiteBite`, which
  // silently assigned a stranger's repository to us.
  const dir = makeRepo();
  try {
    execSync('git init -q . && git remote add origin git@github.com:someone-else/their-tool.git', { cwd: dir });
    const codeowners = renderCodeowners(dir);
    assert.match(codeowners, /\* @someone-else$/m);
    assert.ok(!codeowners.includes('WhiteBite'), 'a foreign repo must not inherit our owner');
  } finally {
    removeRepo(dir);
  }

  const noRemote = makeRepo();
  try {
    assert.equal(renderCodeowners(noRemote), null, 'no remote means no owner: CODEOWNERS must not guess one');
  } finally {
    removeRepo(noRemote);
  }
});

test('renderCitationCff is deterministic and omits date-released', () => {
  const config = { project: { name: 'cite-me', description: 'A citable project' }, keywords: { npm_keywords: ['cli'] } };
  const first = renderCitationCff(config, null);
  assert.equal(renderCitationCff(config, null), first);
  assert.ok(!first.includes('date-released'), 'date-released made the generated file churn daily');
  assert.match(first, /cff-version: 1\.2\.0/);
});

test('renderCitationCff takes the version from the package when the config has none', () => {
  const config = { project: { name: 'cite-me', description: 'A citable project' } };
  assert.match(renderCitationCff(config, { name: 'cite-me', version: '2.0.0' }), /version: "2\.0\.0"/);
  assert.match(renderCitationCff({ ...config, version: '9.9.9' }, { version: '2.0.0' }), /version: "9\.9\.9"/);
  assert.match(renderCitationCff(config, null), /version: "0\.1\.0"/);
});

test('citation stub takes the version from package.json', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'cite-version', version: '2.0.0', description: 'Citable' }),
  });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['citation.stub'] }));
    const cff = readFileSync(join(dir, 'CITATION.cff'), 'utf8');
    assert.match(cff, /version: "2\.0\.0"/);
  } finally {
    removeRepo(dir);
  }
});

test('citationRepositoryRefresh fills only a present-but-empty repository-code', () => {
  assert.equal(citationRepositoryRefresh('cff-version: 1.2.0\nrepository-code: ""\n', 'https://github.com/o/r'), 'cff-version: 1.2.0\nrepository-code: "https://github.com/o/r"\n');
  assert.equal(citationRepositoryRefresh('repository-code:\n', 'https://github.com/o/r'), 'repository-code: "https://github.com/o/r"\n');
  assert.equal(citationRepositoryRefresh('repository-code: ""\r\n', 'https://github.com/o/r'), 'repository-code: "https://github.com/o/r"\r\n');
  assert.equal(citationRepositoryRefresh('repository-code: "https://keep.example"\n', 'https://github.com/o/r'), null);
  assert.equal(citationRepositoryRefresh('repository-code: ""\n', null), null);
  assert.equal(citationRepositoryRefresh('type: software\n', 'https://github.com/o/r'), null);
});

test('generated project.yml points at the tool documentation, not at the audited repo', () => {
  const yml = renderProjectYml({ project: { name: 'docs-link', one_liner: 'Check the docs link' } });
  const docsLine = yml.split('\n').find((line) => line.startsWith('# Docs:'));
  assert.ok(docsLine, 'the generated config must carry a docs link');
  assert.ok(docsLine.includes('/blob/main/docs/configuration.md'), docsLine);
  assert.ok(!docsLine.includes('someone-else'), 'the docs link belongs to the tool, not to the audited repo');
});

test('renderJsonLd derives programmingLanguage from repository markers', () => {
  const py = makeRepo({ 'pyproject.toml': '[project]\nname = "pydemo"\n', 'main.py': 'print(1)\n' });
  const poly = makeRepo({ 'package.json': JSON.stringify({ name: 'poly' }), 'main.py': 'print(1)\n' });
  const bare = makeRepo({ 'README.md': '# bare\n' });
  try {
    const pyJson = JSON.parse(renderJsonLd({ project: { name: 'pydemo' } }, null, py));
    assert.deepEqual(pyJson.programmingLanguage, ['Python']);
    assert.equal(pyJson.runtimePlatform, undefined);

    const polyJson = JSON.parse(renderJsonLd({ project: { name: 'poly' } }, { name: 'poly' }, poly));
    assert.ok(polyJson.programmingLanguage.includes('JavaScript'));
    assert.ok(polyJson.programmingLanguage.includes('Python'));
    assert.equal(polyJson.runtimePlatform, 'Node.js');

    const bareJson = JSON.parse(renderJsonLd({ project: { name: 'bare' } }, null, bare));
    assert.equal(bareJson.programmingLanguage, undefined);
  } finally {
    removeRepo(py);
    removeRepo(poly);
    removeRepo(bare);
  }
});

test('renderJsonLd emits author and sameAs from config and package facts', () => {
  const config = {
    project: { name: 'jsonld-demo', one_liner: 'Demo', copyright_holder: 'Ada Lovelace' },
    links: { issues: 'https://github.com/o/r/issues' },
    keywords: { npm_keywords: ['demo'] },
    artifacts: { npm_published: true },
  };
  const json = JSON.parse(renderJsonLd(config, { name: 'jsonld-demo', version: '1.0.0' }));
  assert.equal(json.author, 'Ada Lovelace');
  assert.deepEqual(json.sameAs, ['https://github.com/o/r', 'https://www.npmjs.com/package/jsonld-demo']);
});

test('renderJsonLd omits the npm sameAs until artifacts.npm_published is set', () => {
  const config = { project: { name: 'unpub' }, links: { issues: 'https://github.com/o/unpub/issues' } };
  const json = JSON.parse(renderJsonLd(config, { name: 'unpub', version: '1.0.0' }));
  assert.deepEqual(json.sameAs, ['https://github.com/o/unpub']);
});

test('renderJsonLd falls back to the repository owner and skips npm for private packages', () => {
  const json = JSON.parse(renderJsonLd({ project: { name: 'x' }, links: { issues: 'https://github.com/some-owner/x/issues' } }, { name: 'x', private: true }));
  assert.equal(json.author, 'some-owner');
  assert.deepEqual(json.sameAs, ['https://github.com/some-owner/x']);
});

test('renderJsonLd omits author and sameAs when no source for them exists', () => {
  const json = JSON.parse(renderJsonLd({ project: { name: 'bare' } }, null));
  assert.equal('author' in json, false);
  assert.equal('sameAs' in json, false);
});

test('license stub names the configured copyright holder, not the project name', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'licensed-project' }),
    [CONFIG_RELATIVE_PATH]: 'project:\n  name: licensed-project\n  copyright_holder: "Ada Lovelace"\n',
  });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['license.stub'] }));
    const license = readFileSync(join(dir, 'LICENSE'), 'utf8');
    assert.match(license, /Copyright \(c\) \d{4} Ada Lovelace/);
    assert.ok(!license.includes('licensed-project'));
  } finally {
    removeRepo(dir);
  }
});

test('license stub falls back to the authors without a copyright_holder', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'unlicensed-project' }) });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['license.stub'] }));
    const license = readFileSync(join(dir, 'LICENSE'), 'utf8');
    assert.match(license, /Copyright \(c\) \d{4} the authors/);
  } finally {
    removeRepo(dir);
  }
});

test('renderCitationCff derives the author before falling back to the TODO stub', () => {
  const config = { project: { name: 'auth-demo' }, keywords: { npm_keywords: [] } };
  const withHolder = { ...config, project: { ...config.project, copyright_holder: 'Jane Doe' } };
  assert.match(renderCitationCff(withHolder, null), /- name: "Jane Doe"/);
  assert.match(renderCitationCff(config, { author: 'Repo Owner' }), /- name: "Repo Owner"/);
  assert.match(renderCitationCff(config, { author: { name: 'Obj Owner' } }), /- name: "Obj Owner"/);
  assert.match(renderCitationCff(config, null), /- name: "TODO: maintainer name"/);
});

test('renderSecurityMd does not assert an unverified telemetry policy', () => {
  const md = renderSecurityMd('demo-project');
  assert.match(md, /demo-project/);
  assert.doesNotMatch(md, /does not transmit telemetry/);
  assert.match(md, /TODO/i);
});
