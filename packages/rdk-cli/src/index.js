/** Programmatic API for repo-aeo. */
export { audit } from './audit/index.js';
export { loadConfig, buildSeedConfig, CONFIG_RELATIVE_PATH } from './config.js';
export { planPatches, applyPatches, PATCHES } from './fix/patches.js';
export { renderMarkdownReport } from './report/markdown.js';
export { renderGithubComment, COMMENT_MARKER } from './report/githubComment.js';
export { AXIS_WEIGHTS, AXIS_LABELS, computeScore, grade } from './audit/score.js';
export { parse as parseYaml } from './yaml.js';
export { githubSyncCommand, DEFAULT_ACK, resolveRepo, effectiveAck, planDigest } from './commands/githubSync.js';
export { submitCommand, insertEntryIntoReadme, buildEntry, readSubmissions, submissionsPath } from './commands/submit.js';
export { trackCommand } from './commands/track.js';
export { assertWriteGuards } from './distribution/guard.js';
export { CHANNELS, CHANNEL_DESCRIPTOR_FIELDS, channelById, applicableChannels } from './distribution/channels.js';
export { readLedger, appendRecords, writeLedger, upsertRecords, syncTransition, applySync, isBlocking, projectStatus } from './distribution/ledger.js';
export { buildDistributionStatus, renderDistributionStatus, DISTRIBUTION_SCHEMA } from './distribution/tracking/status.js';
export { hydrateGitPr, hydrateGitPrBatch, normalizeGhPrView, hydrateByProbe } from './distribution/tracking/hydrate.js';
export { evaluateAttention, neededFor, commandFor, countChecks, isMaintainer } from './distribution/tracking/attention.js';
export { readTrackingCache, writeTrackingCache, trackingCachePath, snapshotKey } from './distribution/tracking/cache.js';
export { discoverOwnedPrs, matchAdoptable, adoptRows, applyAdopt } from './distribution/tracking/adopt.js';
export { artifactInventory, recommend } from './distribution/recommend.js';
export {
  describe as describeGitPr,
  plan as planGitPr,
  execute as executeGitPr,
  probe as probeGitPr,
} from './distribution/mechanisms/gitPr.js';
export {
  describe as describeHttpJson,
  plan as planHttpJson,
  execute as executeHttpJson,
  probe as probeHttpJson,
} from './distribution/mechanisms/httpJson.js';
export {
  describe as describeWebForm,
  plan as planWebForm,
  execute as executeWebForm,
  probe as probeWebForm,
  buildPayload,
} from './distribution/mechanisms/webForm.js';
export {
  describe as describePassive,
  plan as planPassive,
  execute as executePassive,
  probe as probePassive,
  verify,
} from './distribution/mechanisms/passive.js';
export {
  describe as describeCliPublish,
  plan as planCliPublish,
  execute as executeCliPublish,
  probe as probeCliPublish,
  buildChecklist,
  POLICY,
} from './distribution/mechanisms/cliPublish.js';
export { renderServerJson, mcpOwnershipMarker } from './distribution/artifacts/serverJson.js';
export { renderClaudeMarketplace, renderCodexMarketplace } from './distribution/artifacts/marketplaceJson.js';
export { channelsCommand } from './commands/channels.js';
export { auditCommand } from './commands/audit.js';
export { fixCommand } from './commands/fix.js';
export { initCommand } from './commands/init.js';
export { npmSurfaceCommand } from './commands/npmSurface.js';
export { skillCommand, skillSourceDir, skillTargets } from './commands/skill.js';
export { resolvePackage } from './config.js';
export { TOOL_HOME, DEFAULT_OWNER, repoWebUrl, repoOwner, toolDocUrl } from './util/repo.js';
export { generatedDrift, GENERATED_START, GENERATED_END, mergeGenerated, llmsFreshness } from './generate/index.js';
export { httpGetText, parseCurlStatus, isProbeable, probeUrl, probeUrls } from './util/http.js';
