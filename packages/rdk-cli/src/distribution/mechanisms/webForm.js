/**
 * The web-form mechanism: channels that accept submissions only through a
 * human-operated web form. There is no write API, so execute performs no
 * network and no write: it returns the exact human checklist and a record
 * with status 'prepared'. The form is always submitted by a human.
 */
import { join } from 'node:path';

export function describe() {
  return {
    id: 'web-form',
    summary: 'Prepare the payload and an exact human checklist for a channel that accepts entries only through a web form; a human submits the form.',
  };
}

// entries must already be normalized: lowercase, alphanumerics only
const FIELD_ALIASES = {
  name: ['name', 'project', 'projectname', 'title'],
  url: ['url', 'repo', 'repository', 'repourl', 'repositoryurl', 'link'],
  description: ['description', 'desc', 'oneliner', 'summary', 'about'],
  category: ['category', 'type', 'topic'],
};

function normalizeField(field) {
  return String(field).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The target identity: the channel id, or the form URL when there is no id. */
function targetOf(channel) {
  if (!channel) return null;
  const id = String(channel.id || '').trim();
  if (id !== '') return id;
  return String(channel.formUrl || '').trim() || null;
}

/** Unknown or unmatched fields map to '' so a human fills them in. */
export function buildPayload({ config, url, channel }) {
  const project = (config && config.project) || {};
  const values = {
    name: project.name,
    url: url || null,
    description: project.description || project.one_liner,
    category: project.category,
  };
  const fields = channel && Array.isArray(channel.fields) ? channel.fields : [];
  const payload = {};
  for (const field of fields) {
    const normalized = normalizeField(field);
    const semantic = Object.keys(FIELD_ALIASES).find((key) => FIELD_ALIASES[key].includes(normalized));
    payload[field] = semantic && values[semantic] != null ? values[semantic] : '';
  }
  return payload;
}

/** Builds the per-channel plan items; pure, and the direct input of the plan digest. */
export function plan({ channels, config, url }) {
  return (Array.isArray(channels) ? channels : []).map((channel) => ({
    target: targetOf(channel),
    formUrl: (channel && channel.formUrl) || null,
    payload: buildPayload({ config, url, channel }),
    url: url || null,
  }));
}

/**
 * Executes one plan item by preparing the human checklist. The form has no
 * write API, so this performs no network and no write; the record status is
 * 'prepared' and stays that way until a human submits the form. Fails only
 * when no formUrl is available.
 */
export function execute({ item, channel, cwd, config }) {
  const target = (item && item.target) || targetOf(channel);
  const lines = ['', `## ${target}`];
  const fail = (error) => ({ ok: false, error, lines });
  const formUrl = (item && item.formUrl) || (channel && channel.formUrl) || null;
  if (!formUrl) {
    lines.push('❌ no form URL: the channel descriptor must supply formUrl.');
    return fail(`${target || 'web-form channel'}: no formUrl in the channel descriptor`);
  }
  const payload = (item && item.payload) || buildPayload({ config, url: (item && item.url) || null, channel });
  const steps = [
    `Open ${formUrl} in a browser.`,
    ...Object.entries(payload).map(([field, value]) =>
      value == null || value === '' ? `Fill "${field}" (no prepared value; fill it in yourself).` : `Fill "${field}" with: ${value}`,
    ),
    'Submit the form yourself — rdk never submits web forms.',
    `After submitting, set the "${target}" record in ${join(cwd || process.cwd(), '.discoverability', 'submissions.json')} to status "submitted".`,
  ];
  lines.push(`Form: ${formUrl}`);
  lines.push(...steps.map((step) => `- ${step}`));
  lines.push('Prepared, not submitted — a human must fill and submit the form.');
  return {
    ok: true,
    lines,
    record: { target, form_url: formUrl, payload, status: 'prepared', prepared_at: new Date().toISOString() },
    checklist: { steps, target },
  };
}

/** A web-form submission has no programmatic probe: always kind 'none', ref null. */
export function probe(record) {
  return { kind: 'none', ref: null };
}
