import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { prepareData, resolvePlaywright, rasterize } from "./raster-lib.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MAX_LINE = 50;

function clip(text) {
  const s = String(text);
  return s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}\u2026` : s;
}

const template = path.resolve(arg("template", "template.html"));
const dataFile = path.resolve(arg("data", "sample-opencode.json"));
const outArg = arg("out", "");
const out = path.resolve(outArg || "sample.png");
const width = Number(arg("width", "1200"));
const heightArg = arg("height", "auto");
const scale = Number(arg("scale", "2"));
const themeOverride = arg("theme", "");
const prepareOnly = process.argv.includes("--prepare");
const fromCommand = arg("from-command", "");

if (fromCommand) {
  const cwd = arg("cwd", process.cwd());
  const maxLines = Math.max(1, Number(arg("max-lines", "8")) || 8);
  const result = spawnSync(fromCommand, { shell: true, cwd, encoding: "utf8" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  const exit = typeof result.status === "number" ? result.status : 1;
  const lines = `${result.stdout || ""}${result.stderr || ""}`
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const blocks = [{ type: "tool", kind: "call", text: clip(fromCommand) }];
  if (lines.length > maxLines) {
    blocks.push({ type: "status", text: clip(`... ${lines.length - maxLines} earlier lines omitted`) });
  }
  for (const line of lines.slice(-maxLines)) blocks.push({ type: "status", text: clip(line) });
  blocks.push(exit === 0 ? { type: "done", text: "exit 0" } : { type: "status", text: `exit ${exit}` });
  console.log(JSON.stringify(blocks, null, 2));
  process.exit(0);
}

const framesFile = arg("frames", "");
if (framesFile) {
  const outDir = path.resolve(arg("out-dir", "build/frames"));
  let frames;
  try {
    frames = JSON.parse(fs.readFileSync(path.resolve(framesFile), "utf8"));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    console.error("frames file must be a non-empty array of slot JSONs");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const framesDir = path.dirname(path.resolve(framesFile));
  const pngName = (i) => `frame-${String(i).padStart(2, "0")}.png`;
  const listLines = [];
  frames.forEach((frame, i) => {
    try {
      prepareData(frame, framesDir);
    } catch (error) {
      console.error(`frame ${i}: ${error.message}`);
      process.exit(1);
    }
    fs.writeFileSync(path.join(outDir, `frame-${String(i).padStart(2, "0")}.json`), JSON.stringify(frame, null, 2));
    const delay = typeof frame.delay === "number" && frame.delay >= 0 ? frame.delay : 1.0;
    listLines.push(`file '${pngName(i)}'`, `duration ${delay}`);
  });
  listLines.push(`file '${pngName(frames.length - 1)}'`, "duration 3.0");
  const listPath = path.join(outDir, "list.txt");
  fs.writeFileSync(listPath, `${listLines.join("\n")}\n`);
  console.log(`prepared ${frames.length} frames -> ${outDir}`);
  console.log(`wrote ${listPath}`);
  process.exit(0);
}

if (!fs.existsSync(dataFile)) {
  console.error(`missing input: ${dataFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
if (themeOverride) data.theme = themeOverride;
try {
  prepareData(data, path.dirname(dataFile));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const preparedOut = path.join(path.dirname(dataFile), path.basename(dataFile, ".json") + ".prepared.json");

const playwrightSpec = resolvePlaywright();

if (prepareOnly || !playwrightSpec) {
  const target = outArg ? out : preparedOut;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  console.log(`prepared ${path.basename(dataFile)} -> ${target}`);
  if (!prepareOnly) console.log("playwright-core not found; rasterize with an on-demand renderer (see references/visual-assets.md)");
  process.exit(0);
}

if (!fs.existsSync(template)) {
  console.error(`missing input: ${template}`);
  process.exit(1);
}

const { width: renderedWidth, height: renderedHeight, scale: renderedScale } = await rasterize({
  template,
  data,
  out,
  width,
  scale,
  height: heightArg,
});
console.log(`rendered ${path.basename(dataFile)} [${data.theme}] -> ${out} (${renderedWidth}x${renderedHeight} x${renderedScale})`);
