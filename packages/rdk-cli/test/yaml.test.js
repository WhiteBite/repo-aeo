import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, YamlError } from '../src/yaml.js';
import { renderProjectYml } from '../src/generate/index.js';

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

test('quoted list items containing colons parse as strings', () => {
  const result = parse(`
audiences:
  - "a: b"
  - plain
keywords:
  - "CLI: interface"
  - 'single: quoted'
`);
  assert.deepEqual(result.audiences, ['a: b', 'plain']);
  assert.deepEqual(result.keywords, ['CLI: interface', 'single: quoted']);
});

test('unquoted list item with a colon stays a map entry', () => {
  const result = parse(`
items:
  - name: value
`);
  assert.deepEqual(result.items, [{ name: 'value' }]);
});

test('quoted key in a list item still splits on the trailing colon', () => {
  const result = parse(`
items:
  - "a": b
`);
  assert.deepEqual(result.items, [{ a: 'b' }]);
});

test('renderProjectYml round-trips list items containing colons', () => {
  const rendered = renderProjectYml({ audiences: ['a: b', 'plain'] });
  assert.deepEqual(parse(rendered).audiences, ['a: b', 'plain']);
});

test('double-quoted escapes resolve left-to-right: `\\n` after a backslash stays literal', () => {
  const result = parse('k: "a\\\\nb"');
  assert.equal(result.k, 'a\\nb');
  assert.equal(parse('k: "C:\\\\new\\\\test"').k, 'C:\\new\\test');
  assert.equal(parse('k: "a\\nb"').k, 'a\nb');
});

test('block scalars keep blank lines, comments and chomping indicators', () => {
  assert.equal(parse('d: |\n  a\n\n  b\n').d, 'a\n\nb\n');
  assert.equal(parse('d: |\n  use this # one\n').d, 'use this # one\n');
  assert.equal(parse('d: |-\n  a\n  b\n').d, 'a\nb');
  assert.equal(parse('d: |+\n  a\n\n').d, 'a\n\n');
  assert.equal(parse('d: |2\n    a\n').d, '  a\n');
  assert.equal(parse('d: |\n  x\nother: 1\n').other, 1);
  assert.equal(parse('d: |\n  ---\n').d, '---\n');
});

test('folded scalars break paragraphs on blank lines and keep indented lines literal', () => {
  assert.equal(parse('d: >\n  a\n\n  b\n').d, 'a\nb\n');
  assert.equal(parse('d: >\n  a\n  b\n').d, 'a b\n');
  assert.equal(parse('d: >\n  a\n    code\n  b\n').d, 'a\n  code\nb\n');
});

test('unterminated or trailing flow content throws instead of parsing garbage', () => {
  assert.throws(() => parse('k: [a, b'), (error) => error instanceof YamlError && /unterminated/.test(error.message));
  assert.throws(() => parse('k: [a, b] oops'), (error) => error instanceof YamlError && /after flow/.test(error.message));
  assert.throws(() => parse('k: {a}'), (error) => error instanceof YamlError && /without a colon/.test(error.message));
});

test('nested block lists and block scalars in list items fail loudly', () => {
  assert.throws(() => parse('k:\n  - - a'), (error) => error instanceof YamlError && /nested block lists/.test(error.message));
  assert.throws(() => parse('k:\n  - d: |\n      x\n'), (error) => error instanceof YamlError && /inside list items/.test(error.message));
});

test('a second document separator is rejected, `...` ends the document', () => {
  assert.throws(() => parse('a: 1\n---\nb: 2'), (error) => error instanceof YamlError && /multiple documents/.test(error.message));
  assert.deepEqual(parse('a: 1\n...\n'), { a: 1 });
  assert.deepEqual(parse('---\na: 1\n'), { a: 1 });
});
