import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const template = path.resolve(arg("template", "template.html"));
const dataFile = path.resolve(arg("data", "sample-stop-ai-slop.json"));
const out = path.resolve(arg("out", "demo-template-sample.png"));
const width = Number(arg("width", "1200"));
const height = Number(arg("height", "700"));
const scale = Number(arg("scale", "2"));

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

for (const f of [template, dataFile]) {
  if (!fs.existsSync(f)) {
    console.error(`missing input: ${f}`);
    process.exit(1);
  }
}

const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const executablePath = findChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(template).href, { waitUntil: "load" });
  await page.evaluate((d) => window.fillTemplate(d), data);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log(`rendered ${path.basename(dataFile)} -> ${out} (${width}x${height} x${scale})`);
} finally {
  await browser.close();
}
