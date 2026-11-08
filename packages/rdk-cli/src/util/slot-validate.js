/**
 * Validates a demo slot JSON against the v4 slot schema. Zero dependencies so
 * the skill-side check-slot.mjs can import it without pulling in the CLI.
 * Returns { errors, warnings }: errors block a render, warnings only degrade it.
 */

const THEMES = new Set(['opencode', 'claude-code', 'codex', 'shell']);
const PALETTES = new Set(['dark', 'light']);
const SURFACES = new Set(['terminal', 'files', 'shots', 'single']);
const BLOCK_TYPES = new Set(['user', 'prose', 'tool', 'status', 'done', 'diff', 'file', 'steps', 'gate', 'divider']);
const HUD_TONES = new Set(['muted', 'learn', 'block', 'heal']);
const MAX_BLOCKS = 5;
const MAX_LINE = 50;
const MAX_BLOCKS_SINGLE = 12;
const MAX_LINE_SINGLE = 80;
const MAX_STEPS = 8;

function lineTexts(block) {
  const texts = [];
  if (typeof block.text === 'string') texts.push(block.text);
  if (typeof block.title === 'string') texts.push(block.title);
  if (Array.isArray(block.lines)) {
    for (const line of block.lines) {
      if (typeof line === 'string') {
        texts.push(line);
        continue;
      }
      if (!line || typeof line !== 'object') continue;
      for (const key of ['text', 'left', 'right']) {
        if (typeof line[key] === 'string') texts.push(line[key]);
      }
    }
  }
  if (Array.isArray(block.steps)) {
    for (const step of block.steps) {
      if (step && typeof step.text === 'string') texts.push(step.text);
    }
  }
  return texts;
}

function validateHud(hud, label, errors) {
  if (hud === undefined) return;
  if (!hud || typeof hud !== 'object' || Array.isArray(hud)) {
    errors.push(`${label}: hud must be an object`);
    return;
  }
  if (typeof hud.text !== 'string' || hud.text.trim() === '') {
    errors.push(`${label}: hud.text is required and must be a non-empty string`);
  }
  if (!HUD_TONES.has(hud.tone)) {
    errors.push(`${label}: hud.tone must be one of muted|learn|block|heal, got ${JSON.stringify(hud.tone)}`);
  }
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
  if (obj.palette !== undefined && !PALETTES.has(obj.palette)) {
    errors.push(`palette must be one of dark|light, got ${JSON.stringify(obj.palette)}`);
  }
  if (typeof obj.takeaway !== 'string' || obj.takeaway.trim() === '') {
    errors.push('takeaway is required and must be a non-empty string');
  }
  validateHud(obj.hud, 'hud', errors);
  if (typeof obj.delay === 'number' && obj.delay > 0 && obj.delay < 0.02) {
    warnings.push(`delay ${obj.delay}s is below the 0.02s GIF floor; browsers clamp sub-20ms delays to 100ms`);
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
      errors.push(`${panelName}: surface must be terminal|files|shots|single, got ${JSON.stringify(surface)}`);
    }
    validateHud(panel.hud, `${panelName}.hud`, errors);
    const blocks = Array.isArray(panel.blocks) ? panel.blocks : [];
    if (surface === 'shots') {
      if (typeof panel.shot !== 'string' || panel.shot.trim() === '') {
        errors.push(`${panelName}: shots surface requires a non-empty shot`);
      }
      if (blocks.length > 0) {
        warnings.push(`${panelName}: blocks are ignored on a shots panel`);
      }
    }
    if (surface === 'single' && blocks.length === 0) {
      errors.push(`${panelName}: single surface requires at least one block`);
    }
    const maxBlocks = surface === 'single' ? MAX_BLOCKS_SINGLE : MAX_BLOCKS;
    if (blocks.length > maxBlocks) {
      errors.push(`${panelName}: ${blocks.length} blocks exceeds the ${maxBlocks}-block limit`);
    }
    const maxLine = surface === 'single' ? MAX_LINE_SINGLE : MAX_LINE;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (!BLOCK_TYPES.has(block.type)) {
        warnings.push(`${panelName}: unknown block type ${JSON.stringify(block.type)} (rendered as prose)`);
      }
      if (block.type === 'steps' && Array.isArray(block.steps) && block.steps.length > MAX_STEPS) {
        warnings.push(`${panelName}: steps block has ${block.steps.length} entries; only ${MAX_STEPS} render`);
      }
      if (block.type === 'gate') {
        if (typeof block.title !== 'string' || block.title.trim() === '') {
          errors.push(`${panelName}: gate block requires a non-empty title`);
        }
        if (!Array.isArray(block.lines)) {
          errors.push(`${panelName}: gate block requires a lines array`);
        }
      }
      if (block.type === 'divider' && (typeof block.text !== 'string' || block.text.trim() === '')) {
        errors.push(`${panelName}: divider block requires a non-empty text`);
      }
      for (const text of lineTexts(block)) {
        if (text.length > maxLine) {
          errors.push(`${panelName}: line exceeds ${maxLine} chars: ${JSON.stringify(text.slice(0, 60))}`);
        }
      }
    }
  }
  return { errors, warnings };
}
