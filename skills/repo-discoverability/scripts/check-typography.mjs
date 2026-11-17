#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const ROLE_FLOORS = { display: 48, text: 15, micro: 13 };

const SELECTOR_ROLES = new Map([
  ['.hero-title', 'display'],
  ['.hero-subtitle', 'text'],
  ['.hero-card-heading', 'text'],
  ['.hero-card-body', 'text'],
  ['.hero-eyebrow', 'micro'],
  ['.hero-meta', 'micro'],
  ['.panel-caption', 'text'],
  ['.session-title', 'text'],
  ['.takeaway', 'text'],
  ['.window-title', 'text'],
  ['.user-msg', 'text'],
  ['.prose-line', 'text'],
  ['.tool-line', 'text'],
  ['.diff', 'text'],
  ['.file', 'text'],
  ['.status', 'text'],
  ['.done', 'text'],
  ['.steps', 'text'],
  ['.steps-collapse', 'text'],
  ['.gate', 'text'],
  ['.panel[data-surface="single"] .panel-caption', 'text'],
  ['.file-path', 'micro'],
  ['.steps-more', 'micro'],
  ['.shot-anno-label', 'micro'],
  ['.shot-caption', 'micro'],
  ['.hud', 'micro'],
  ['.divider', 'micro'],
  ['code', 'micro'],
]);

const REMOTE_RESOURCES = [
  [/@import\b/i, '@import'],
  [/@font-face\b/i, '@font-face'],
  [/<script\b[^>]*\bsrc\s*=/i, '<script src='],
  [/<link\b[^>]*\bhref\s*=\s*["']https?:/i, 'remote <link>'],
  [/url\(\s*["']?https?:/i, 'url(http'],
];

function styleBlocks(source) {
  const blocks = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = re.exec(source)) !== null) blocks.push(match[1]);
  return blocks;
}

function cssRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (selector) rules.push({ selector, body: match[2] });
  }
  return rules;
}

function fontSizes(body) {
  const values = [];
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    if (part.slice(0, colon).trim().toLowerCase() !== 'font-size') continue;
    values.push(part.slice(colon + 1).trim());
  }
  return values;
}

function rolesFor(selector, errors) {
  const roles = [];
  for (const part of selector.split(',').map((p) => p.trim().replace(/\s+/g, ' '))) {
    if (!part) continue;
    const role = SELECTOR_ROLES.get(part);
    if (role) roles.push(role);
    else errors.push(`unmapped selector with font-size: ${part}`);
  }
  return roles;
}

function checkTemplate(source) {
  const errors = [];
  let count = 0;

  for (const [pattern, label] of REMOTE_RESOURCES) {
    if (pattern.test(source)) errors.push(`remote resource is not allowed: ${label}`);
  }
  if (!source.includes('width: 900px')) errors.push('template must declare a 900px stage (width: 900px)');

  for (const block of styleBlocks(source)) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const { selector, body } of cssRules(css)) {
      const values = fontSizes(body);
      if (values.length === 0) continue;
      const roles = rolesFor(selector, errors);
      for (const value of values) {
        count += 1;
        const px = /^(\d+(?:\.\d+)?)px$/i.exec(value);
        if (!px) {
          errors.push(`${selector}: font-size must be declared in px (got ${value})`);
          continue;
        }
        const size = Number(px[1]);
        for (const role of roles) {
          if (size < ROLE_FLOORS[role]) {
            errors.push(`${selector}: font-size ${size}px is below the ${role} minimum of ${ROLE_FLOORS[role]}px`);
          }
        }
      }
    }
  }

  return { errors, count };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node check-typography.mjs <template.html...>');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`${file}: error: ${error.message}`);
    failed = true;
    continue;
  }
  const { errors, count } = checkTemplate(source);
  if (errors.length > 0) {
    for (const message of errors) console.error(`${file}: error: ${message}`);
    failed = true;
  } else {
    console.log(`${file}: ok (${count} font-size declarations)`);
  }
}

process.exit(failed ? 1 : 0);