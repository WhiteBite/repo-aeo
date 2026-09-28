import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, YamlError } from '../src/yaml.js';

test('parses nested maps and lists', () => {
  const result = parse(`
project:
  name: demo
  category: library
keywords:
  github_topics:
    - cli
    - developer-tools
  npm_keywords: [one, two, "three"]
quickstart:
  prerequisites:
    - Node.js >= 18
  install: npm install demo
safety:
  allow_autofix: false
  require_ack_for_publish: true
`);
  assert.equal(result.project.name, 'demo');
  assert.equal(result.project.category, 'library');
  assert.deepEqual(result.keywords.github_topics, ['cli', 'developer-tools']);
  assert.deepEqual(result.keywords.npm_keywords, ['one', 'two', 'three']);
  assert.deepEqual(result.quickstart.prerequisites, ['Node.js >= 18']);
  assert.equal(result.quickstart.install, 'npm install demo');
  assert.equal(result.safety.allow_autofix, false);
  assert.equal(result.safety.require_ack_for_publish, true);
});

test('ignores comments, including # inside quotes and URLs', () => {
  const result = parse(`
# leading comment
links:
  homepage: "https://example.com/#anchor"   # trailing comment
  docs: https://example.com/docs#frag
`);
  assert.equal(result.links.homepage, 'https://example.com/#anchor');
  assert.equal(result.links.docs, 'https://example.com/docs#frag');
});

test('supports block scalars', () => {
  const result = parse(`
project:
  description: |
    line one
    line two
  one_liner: >
    folded one
    folded two
`);
  assert.equal(result.project.description, 'line one\nline two\n');
  assert.equal(result.project.one_liner, 'folded one folded two\n');
});

test('coerces numbers and null', () => {
  const result = parse(`
a: 42
b: 3.5
c: null
d: ~
e: '42'
`);
  assert.equal(result.a, 42);
  assert.equal(result.b, 3.5);
  assert.equal(result.c, null);
  assert.equal(result.d, null);
  assert.equal(result.e, '42');
});

test('throws a descriptive error on tab indentation', () => {
  assert.throws(() => parse('project:\n\tname: x\n'), (error) => error instanceof YamlError && /tabs/.test(error.message));
});

test('throws on unexpected content', () => {
  assert.throws(() => parse('project:\n  name: x\n  bad line here\n'), (error) => error instanceof YamlError);
});

test('empty document yields an object', () => {
  assert.deepEqual(parse(''), {});
  assert.deepEqual(parse('# only a comment\n'), {});
});
