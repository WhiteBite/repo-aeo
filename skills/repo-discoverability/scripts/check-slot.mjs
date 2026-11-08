#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateSlot } from '../../../packages/rdk-cli/src/util/slot-validate.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node check-slot.mjs <file...>');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`${file}: error: invalid JSON (${error.message})`);
    failed = true;
    continue;
  }
  const entries = Array.isArray(data) ? data : [data];
  if (Array.isArray(data) && entries.length === 0) {
    console.error(`${file}: error: frames file must be a non-empty array`);
    failed = true;
    continue;
  }
  let fileOk = true;
  entries.forEach((entry, i) => {
    const label = Array.isArray(data) ? `${file}[${i}]` : file;
    const { errors, warnings } = validateSlot(entry);
    for (const warning of warnings) console.error(`${label}: warning: ${warning}`);
    for (const error of errors) console.error(`${label}: error: ${error}`);
    if (errors.length > 0) fileOk = false;
  });
  if (!fileOk) failed = true;
  else console.log(`${file}: ok`);
}

process.exit(failed ? 1 : 0);
