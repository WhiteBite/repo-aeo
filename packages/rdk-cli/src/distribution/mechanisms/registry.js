/**
 * The mechanism registry: channel descriptors name a mechanism id, and this
 * module maps every id to its executor module so commands can dispatch by
 * channel without importing each mechanism directly.
 */
import * as gitPr from './gitPr.js';
import * as httpJson from './httpJson.js';
import * as webForm from './webForm.js';
import * as passive from './passive.js';
import * as cliPublish from './cliPublish.js';

export const MECHANISMS = {
  'git-pr': gitPr,
  'http-json': httpJson,
  'web-form': webForm,
  passive,
  'cli-publish': cliPublish,
};

export function mechanismById(id) {
  return Object.hasOwn(MECHANISMS, id) ? MECHANISMS[id] : null;
}
