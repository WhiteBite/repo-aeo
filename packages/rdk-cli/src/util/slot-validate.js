/**
 * Validates a demo slot JSON against the v4 slot schema. Zero dependencies so
 * the skill-side check-slot.mjs can import it without pulling in the CLI.
 * Returns { errors, warnings }: errors block a render, warnings only degrade it.
 */

const THEMES = new Set(['opencode', 'claude-code', 'codex', 'shell']);
const SURFACES = new Set(['terminal', 'files']);
const BLOCK_TYPES = new Set(['user', 'prose', 'tool', 'status', 'done', 'diff', 'file']);
const MAX_BLOCKS = 5;
const MAX_LINE = 50;

function lineTexts(block) {
  const texts = [];
  if (typeof block.text === 'string') texts.push(block.text);
  if (Array.isArray(block.lines)) {
    for (const line of block.lines) {
      if (!line || typeof line !== 'object') continue;
      for (const key of ['text', 'left', 'right']) {
        if (typeof line[key] === 'string') texts.push(line[key]);
      }
    }
  }
  return texts;
}

export function validateSlot(obj) {
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push('slot JSON must be an object');
    return { errors, warnings };
  }
  if (obj.schema !== undefined && obj.schema !== 4) {
    errors.push(`schema must be 4 when present, got ${JSON.stringify(obj.schema)}`);
  }
  if (!THEMES.has(obj.theme)) {
    errors.push(`theme must be one of opencode|claude-code|codex|shell, got ${JSON.stringify(obj.theme)}`);
  }
  if (typeof obj.takeaway !== 'string' || obj.takeaway.trim() === '') {
    errors.push('takeaway is required and must be a non-empty string');
  }
  for (const panelName of ['before', 'after']) {
    const panel = obj[panelName];
    if (!panel || typeof panel !== 'object' || Array.isArray(panel)) {
      errors.push(`${panelName} panel is required`);
      continue;
    }
    const surface = panel.surface ?? obj.surface;
    if (surface === undefined) {
      warnings.push(`${panelName}: surface absent, defaults to terminal`);
    } else if (!SURFACES.has(surface)) {
      errors.push(`${panelName}: surface must be terminal|files, got ${JSON.stringify(surface)}`);
    }
    const blocks = Array.isArray(panel.blocks) ? panel.blocks : [];
    if (blocks.length > MAX_BLOCKS) {
      errors.push(`${panelName}: ${blocks.length} blocks exceeds the ${MAX_BLOCKS}-block limit`);
    }
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (!BLOCK_TYPES.has(block.type)) {
        warnings.push(`${panelName}: unknown block type ${JSON.stringify(block.type)} (rendered as prose)`);
      }
      for (const text of lineTexts(block)) {
        if (text.length > MAX_LINE) {
          errors.push(`${panelName}: line exceeds ${MAX_LINE} chars: ${JSON.stringify(text.slice(0, 60))}`);
        }
      }
    }
  }
  return { errors, warnings };
}
