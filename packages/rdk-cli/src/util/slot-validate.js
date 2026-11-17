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
const MAX_LINE = 37;
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

const HERO_MODES = new Set(['split', 'copy-only', 'strip', 'wall', 'rail']);
const HERO_MIN_CARDS = new Set(['strip', 'wall']);
const HERO_MOTIFS = new Set(['none', 'grid', 'rule']);
const HERO_TONES = new Set(['accent1', 'accent2', 'accent3']);
const HERO_HEX_RE = /^#[0-9a-f]{6}$/i;

export function validateHero(obj) {
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push('hero JSON must be an object');
    return { errors, warnings };
  }
  if (obj.kind !== 'hero') {
    errors.push(`kind must be 'hero', got ${JSON.stringify(obj.kind)}`);
  }
  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    errors.push('title is required and must be a non-empty string');
  } else if (obj.title.length > 40) {
    errors.push(`title is ${obj.title.length} chars; the hero limit is 40`);
  }
  if (typeof obj.subtitle !== 'string' || obj.subtitle.trim() === '') {
    errors.push('subtitle is required and must be a non-empty string');
  } else if (obj.subtitle.length > 90) {
    errors.push(`subtitle is ${obj.subtitle.length} chars; the hero limit is 90`);
  }
  if (obj.eyebrow !== undefined) {
    if (typeof obj.eyebrow !== 'string') {
      errors.push('eyebrow must be a string when present');
    } else {
      if (obj.eyebrow.length > 40) errors.push(`eyebrow is ${obj.eyebrow.length} chars; the hero limit is 40`);
      if (/[a-z]/.test(obj.eyebrow)) warnings.push('eyebrow contains lowercase letters; author it uppercase (the template uppercases rendering only)');
    }
  }
  if (obj.accentWord !== undefined) {
    if (typeof obj.accentWord !== 'string') {
      errors.push('accentWord must be a string when present');
    } else if (obj.accentWord.length > 24) {
      errors.push(`accentWord is ${obj.accentWord.length} chars; the hero limit is 24`);
    } else if (typeof obj.title === 'string' && obj.title.indexOf(obj.accentWord) === -1) {
      warnings.push('accentWord does not appear in title; nothing is accented');
    }
  }
  if (obj.palette !== 'dark' && obj.palette !== 'light') {
    errors.push(`palette is required and must be one of dark|light, got ${JSON.stringify(obj.palette)}`);
  }
  if (obj.accent !== undefined && (typeof obj.accent !== 'string' || !HERO_HEX_RE.test(obj.accent))) {
    errors.push(`accent must match #rrggbb, got ${JSON.stringify(obj.accent)}`);
  }
  if (obj.meta !== undefined) {
    if (typeof obj.meta !== 'string') {
      errors.push('meta must be a string when present');
    } else if (obj.meta.length > 60) {
      errors.push(`meta is ${obj.meta.length} chars; the hero limit is 60`);
    }
  }
  const mode = obj.mode === undefined ? 'split' : obj.mode;
  if (!HERO_MODES.has(mode)) {
    errors.push(`mode must be one of split|copy-only|strip|wall|rail, got ${JSON.stringify(obj.mode)}`);
  }
  if (obj.motif !== undefined && !HERO_MOTIFS.has(obj.motif)) {
    errors.push(`motif must be one of none|grid|rule, got ${JSON.stringify(obj.motif)}`);
  }
  if (obj.cards !== undefined) {
    if (!Array.isArray(obj.cards)) {
      errors.push('cards must be an array when present');
    } else {
      if (obj.cards.length > 4) errors.push(`cards has ${obj.cards.length} entries; the hero limit is 4`);
      obj.cards.forEach((card, index) => {
        const label = `cards[${index}]`;
        if (!card || typeof card !== 'object' || Array.isArray(card)) {
          errors.push(`${label} must be an object`);
          return;
        }
        if (typeof card.heading !== 'string' || card.heading.trim() === '') {
          errors.push(`${label}.heading is required and must be a non-empty string`);
        } else if (card.heading.length > 30) {
          errors.push(`${label}.heading is ${card.heading.length} chars; the limit is 30`);
        }
        if (typeof card.body !== 'string' || card.body.trim() === '') {
          errors.push(`${label}.body is required and must be a non-empty string`);
        } else if (card.body.length > 90) {
          errors.push(`${label}.body is ${card.body.length} chars; the limit is 90`);
        }
        if (card.rotate !== undefined) {
          if (typeof card.rotate !== 'number' || !Number.isFinite(card.rotate)) {
            errors.push(`${label}.rotate must be a number when present`);
          } else if (card.rotate < -6 || card.rotate > 6) {
            errors.push(`${label}.rotate ${card.rotate} is outside the -6..6 range`);
          }
        }
        if (card.tone !== undefined && !HERO_TONES.has(card.tone)) {
          errors.push(`${label}.tone must be one of accent1|accent2|accent3, got ${JSON.stringify(card.tone)}`);
        }
      });
      if (mode === 'copy-only' && obj.cards.length > 0) {
        warnings.push('mode is copy-only; cards are ignored');
      }
    }
  }
  if (HERO_MIN_CARDS.has(mode) && (!Array.isArray(obj.cards) || obj.cards.length < 3)) {
    errors.push(`mode ${mode} requires at least 3 cards`);
  }
  if (obj.steps !== undefined) {
    if (!Array.isArray(obj.steps)) {
      errors.push('steps must be an array when present');
    } else {
      if (obj.steps.length < 2 || obj.steps.length > 3) {
        errors.push(`steps has ${obj.steps.length} entries; the rail takes 2 or 3`);
      }
      obj.steps.forEach((step, index) => {
        const label = `steps[${index}]`;
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          errors.push(`${label} must be an object`);
          return;
        }
        if (typeof step.label !== 'string' || step.label.trim() === '') {
          errors.push(`${label}.label is required and must be a non-empty string`);
        } else if (step.label.length > 24) {
          errors.push(`${label}.label is ${step.label.length} chars; the rail limit is 24`);
        }
        for (const [field, limit] of [['count', 6], ['unit', 24], ['note', 28]]) {
          if (step[field] === undefined) continue;
          if (typeof step[field] !== 'string') {
            errors.push(`${label}.${field} must be a string when present`);
          } else if (step[field].length > limit) {
            errors.push(`${label}.${field} is ${step[field].length} chars; the rail limit is ${limit}`);
          }
        }
      });
    }
  }
  if (obj.artifact !== undefined) {
    if (!Array.isArray(obj.artifact)) {
      errors.push('artifact must be an array when present');
    } else {
      if (obj.artifact.length < 1 || obj.artifact.length > 2) {
        errors.push(`artifact has ${obj.artifact.length} entries; the rail takes 1 or 2`);
      }
      obj.artifact.forEach((item, index) => {
        const label = `artifact[${index}]`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`${label} must be an object`);
          return;
        }
        if (typeof item.title !== 'string' || item.title.trim() === '') {
          errors.push(`${label}.title is required and must be a non-empty string`);
        } else if (item.title.length > 24) {
          errors.push(`${label}.title is ${item.title.length} chars; the rail limit is 24`);
        }
        if (!Array.isArray(item.lines) || item.lines.length === 0) {
          errors.push(`${label}.lines is required and must be a non-empty array`);
          return;
        }
        if (item.lines.length > 2) {
          errors.push(`${label}.lines has ${item.lines.length} entries; the rail takes at most 2`);
        }
        item.lines.forEach((line, lineIndex) => {
          if (typeof line !== 'string' || line.trim() === '') {
            errors.push(`${label}.lines[${lineIndex}] must be a non-empty string`);
          } else if (line.length > 44) {
            errors.push(`${label}.lines[${lineIndex}] is ${line.length} chars; the gate card fits 44`);
          }
        });
      });
    }
  }
  if (mode === 'rail') {
    if (!Array.isArray(obj.steps) || obj.steps.length < 2) errors.push('rail mode requires 2 or 3 steps');
    if (!Array.isArray(obj.artifact) || obj.artifact.length < 1) errors.push('rail mode requires 1 or 2 artifact messages');
  }
  if (mode !== 'rail' && Array.isArray(obj.steps) && obj.steps.length > 0) {
    warnings.push(`mode ${mode} ignores steps; they render only in rail mode`);
  }
  if (mode !== 'rail' && Array.isArray(obj.artifact) && obj.artifact.length > 0) {
    warnings.push(`mode ${mode} ignores artifact; it renders only in rail mode`);
  }
  return { errors, warnings };
}

export function validateSlot(obj) {
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push('slot JSON must be an object');
    return { errors, warnings };
  }
  if (obj.kind === 'hero') {
    errors.push('hero document: use validateHero instead of validateSlot');
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
        if (block.type === 'gate' && text.length > 35) {
          warnings.push(`${panelName}: gate line is ${text.length} chars; the gate card is the narrowest container (35)`);
        }
        if (text.length > maxLine) {
          errors.push(`${panelName}: line exceeds ${maxLine} chars: ${JSON.stringify(text.slice(0, 60))}`);
        }
      }
    }
  }
  return { errors, warnings };
}
