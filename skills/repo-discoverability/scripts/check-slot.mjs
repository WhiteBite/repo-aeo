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
  const { errors, warnings } = validateSlot(data);
  for (const warning of warnings) console.error(`${file}: warning: ${warning}`);
  for (const error of errors) console.error(`${file}: error: ${error}`);
  if (errors.length > 0) failed = true;
  else console.log(`${file}: ok`);
}

process.exit(failed ? 1 : 0);
