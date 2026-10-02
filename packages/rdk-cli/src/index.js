/** Programmatic API for repo-aeo. */
export { audit } from './audit/index.js';
export { loadConfig, buildSeedConfig, CONFIG_RELATIVE_PATH } from './config.js';
export { planPatches, applyPatches, PATCHES } from './fix/patches.js';
export { renderMarkdownReport } from './report/markdown.js';
export { renderGithubComment, COMMENT_MARKER } from './report/githubComment.js';
export { AXIS_WEIGHTS, AXIS_LABELS, computeScore, grade } from './audit/score.js';
export { parse as parseYaml } from './yaml.js';
export { githubSyncCommand, DEFAULT_ACK, resolveRepo, effectiveAck, planDigest } from './commands/githubSync.js';
export { auditCommand } from './commands/audit.js';
export { fixCommand } from './commands/fix.js';
export { initCommand } from './commands/init.js';
export { npmSurfaceCommand } from './commands/npmSurface.js';
export { skillCommand, skillSourceDir, skillTargets } from './commands/skill.js';
export { resolvePackage } from './config.js';
export { TOOL_HOME, DEFAULT_OWNER, repoWebUrl, repoOwner, toolDocUrl } from './util/repo.js';
export { generatedDrift, GENERATED_START, GENERATED_END, mergeGenerated, llmsFreshness } from './generate/index.js';
export { httpGetText, parseCurlStatus, isProbeable, probeUrl, probeUrls } from './util/http.js';
