import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
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

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function prepareData(data, dataDir) {
  for (const pk of ["before", "after"]) {
    const panel = data[pk];
    if (!panel || typeof panel !== "object" || typeof panel.shot !== "string") continue;
    const shotPath = path.resolve(dataDir, panel.shot);
    if (!fs.existsSync(shotPath)) throw new Error(`shot not found: ${shotPath}`);
    const buf = fs.readFileSync(shotPath);
    const isPng = buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (isPng) {
      panel.shotW = buf.readUInt32BE(16);
      panel.shotH = buf.readUInt32BE(20);
    } else if (typeof panel.shotW !== "number" || typeof panel.shotH !== "number") {
      throw new Error(`shot ${panel.shot} is not a PNG; author shotW and shotH in the slot JSON`);
    }
    const mime = MIME[path.extname(shotPath).toLowerCase()] || "application/octet-stream";
    panel.shot = `data:${mime};base64,${buf.toString("base64")}`;
  }
  return data;
}

function findChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs) {
      for (const rel of [["chrome-win64", "chrome.exe"], ["chrome-win", "chrome.exe"], ["chrome-linux", "chrome"], ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"]]) {
        const exe = path.join(root, d, ...rel);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
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

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  chromium = null;
}

if (prepareOnly || !chromium) {
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

const executablePath = findChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(template).href, { waitUntil: "load" });
  await page.evaluate((d) => window.fillTemplate(d), data);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  let height = heightArg === "auto" ? 0 : Number(heightArg);
  if (!height) {
    height = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
    height = Math.max(height, 200);
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log(`rendered ${path.basename(dataFile)} [${data.theme}] -> ${out} (${width}x${height} x${scale})`);
} finally {
  await browser.close();
}
