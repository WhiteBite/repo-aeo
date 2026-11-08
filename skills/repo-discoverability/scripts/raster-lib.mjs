import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function prepareData(data, dataDir) {
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

export function findChromium() {
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

// resolve through the package's export map, not a hardcoded index.mjs, so entry renames and hoisted layouts still work
export function resolvePlaywright(playwrightDir) {
  const base = playwrightDir ? path.join(path.resolve(playwrightDir), "package.json") : import.meta.url;
  let pkgPath;
  try {
    pkgPath = createRequire(base).resolve("playwright-core/package.json");
  } catch {
    return undefined;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const entry = pkg.exports?.["."]?.import ?? pkg.exports?.["."]?.default ?? pkg.main ?? "index.js";
  return pathToFileURL(path.join(path.dirname(pkgPath), entry)).href;
}

export async function rasterize({ template, data, out, width, scale, playwrightDir, height = "auto" }) {
  const spec = resolvePlaywright(playwrightDir);
  if (!spec) throw new Error(`playwright-core not resolvable${playwrightDir ? ` from ${playwrightDir}` : ""}`);
  const { chromium } = await import(spec);
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(template).href, { waitUntil: "load" });
    await page.evaluate((d) => window.fillTemplate(d), data);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    let resolvedHeight = height === "auto" ? 0 : Number(height);
    if (!resolvedHeight) {
      resolvedHeight = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
      resolvedHeight = Math.max(resolvedHeight, 200);
    }
    await page.setViewportSize({ width, height: resolvedHeight });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: false });
    return { width, height: resolvedHeight, scale };
  } finally {
    await browser.close();
  }
}
