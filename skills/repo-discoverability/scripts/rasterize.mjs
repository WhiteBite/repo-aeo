#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { prepareData, resolvePlaywright, rasterize } from "./raster-lib.mjs";

const USAGE = `usage: node rasterize.mjs --template <html> --data <json> --out <png> [options]

Rasterize a prepared demo slot JSON with an on-demand playwright-core.

Options:
  --template <file>       locked template HTML (required)
  --data <file>           prepared slot JSON (required)
  --out <file>            output PNG path (required)
  --width <px>            viewport width (default 900)
  --scale <n>             device scale factor (default 1)
  --playwright-dir <dir>  scratch dir with playwright-core installed
                          (default: $PLAYWRIGHT_DIR, else a probed scratch root)
  --help                  print this usage

Set up the scratch renderer outside the repo:
  mkdir demo-render && cd demo-render && npm i playwright-core
`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

const template = arg("template", "");
const dataFile = arg("data", "");
const outArg = arg("out", "");
const width = Number(arg("width", "900"));
const scale = Number(arg("scale", "1"));

if (!template || !dataFile || !outArg) {
  console.error(USAGE);
  process.exit(2);
}

const templatePath = path.resolve(template);
const dataPath = path.resolve(dataFile);
const out = path.resolve(outArg);

const explicitDir = arg("playwright-dir", "");
let playwrightDir;
if (explicitDir) {
  playwrightDir = path.resolve(explicitDir);
  if (!resolvePlaywright(playwrightDir)) {
    console.error(`playwright-core not resolvable from ${playwrightDir}`);
    process.exit(1);
  }
} else {
  playwrightDir = [
    process.env.PLAYWRIGHT_DIR,
    path.join(os.tmpdir(), "opencode", "oc-tui-template"),
    path.join(os.tmpdir(), "oc-tui-template"),
    path.join(process.cwd(), "demo-render"),
  ]
    .filter(Boolean)
    .find((dir) => resolvePlaywright(dir));
}
if (!playwrightDir) {
  console.error("playwright-core not found. Set up a scratch renderer outside the repo:");
  console.error("  mkdir demo-render && cd demo-render && npm i playwright-core");
  console.error("then pass --playwright-dir <scratch> (or set PLAYWRIGHT_DIR).");
  process.exit(1);
}

if (!fs.existsSync(templatePath)) {
  console.error(`missing input: ${templatePath}`);
  process.exit(1);
}
if (!fs.existsSync(dataPath)) {
  console.error(`missing input: ${dataPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
try {
  prepareData(data, path.dirname(dataPath));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { width: renderedWidth, height: renderedHeight, scale: renderedScale } = await rasterize({
  template: templatePath,
  data,
  out,
  width,
  scale,
  playwrightDir,
});
console.log(`rendered ${path.basename(dataPath)} [${data.theme}] -> ${out} (${renderedWidth}x${renderedHeight} x${renderedScale})`);
