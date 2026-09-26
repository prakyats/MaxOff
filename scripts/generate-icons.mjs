// Renders public/icons/icon.svg into the PNG sizes the manifest and iOS need, plus the iPhone
// launch screens, using the Chromium that Playwright already installs. Run after changing the
// SVG or src/core/ui/pwa/launch-screens.json:
//   node scripts/generate-icons.mjs
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "public", "icons");
const startupDir = path.join(iconsDir, "startup");
const svg = await readFile(path.join(iconsDir, "icon.svg"), "utf8");
const launch = JSON.parse(
  await readFile(path.join(root, "src", "core", "ui", "pwa", "launch-screens.json"), "utf8"),
);

// Apple touch icon: iOS masks it itself, so it is full-bleed with the mark in the central 80%.
const fullBleed = svg
  .replace(/rx="\d+"/, 'rx="0"')
  .replace("<path ", '<path transform="translate(256 256) scale(0.8) translate(-256 -256)" ');

// Maskable (2.7): Android shows it masked to a circle on the launcher AND at a fixed size on the
// launch splash, where a full-bleed red square read as an oversized red disc. So the whole
// rounded mark sits at `maskableMarkFraction` of the canvas (0.6: its rounded corners just
// reach the 40%-radius safe circle) on the splash background, opaque as the spec requires.
// On the dark splash the padding is invisible, which is what "padding inside the PNG" buys.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${launch.background}"/>
  <g transform="translate(256 256) scale(${launch.maskableMarkFraction}) translate(-256 -256)">${svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")}</g>
</svg>`;

/** @type {Array<{ file: string; size: number; source: string }>} */
const outputs = [
  { file: "icon-192.png", size: 192, source: svg },
  { file: "icon-512.png", size: 512, source: svg },
  { file: "icon-maskable-512.png", size: 512, source: maskable },
  { file: "apple-touch-icon.png", size: 180, source: fullBleed },
];

/** The launch screen's file name, shared with the layout's `startupImage` list. */
const startupFile = ({ width, height, ratio }) => `iphone-${width}x${height}@${ratio}.png`;

await mkdir(iconsDir, { recursive: true });
await rm(startupDir, { recursive: true, force: true });
await mkdir(startupDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { file, size, source } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    );
    const png = await page.screenshot({ omitBackground: true, type: "png" });
    await writeFile(path.join(iconsDir, file), png);
    await page.close();
    console.warn(`wrote public/icons/${file} (${size}px)`);
  }

  // iOS launch screens (2.7): without one an installed iPhone app starts on white. The mark is
  // drawn where the intro draws it (`launch-intro.tsx`): `markSize` CSS px, centred in the area
  // below the status bar, because with statusBarStyle "default" the web view starts there.
  for (const screen of launch.screens) {
    const { width, height, ratio, statusBar } = screen;
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: ratio,
    });
    const top = statusBar + (height - statusBar) / 2 - launch.markSize / 2;
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;height:100%;background:${launch.background}}svg{position:absolute;left:${(width - launch.markSize) / 2}px;top:${top}px;width:${launch.markSize}px;height:${launch.markSize}px}</style>${svg}`,
    );
    const png = await page.screenshot({ type: "png" });
    await writeFile(path.join(startupDir, startupFile(screen)), png);
    await page.close();
    console.warn(`wrote public/icons/startup/${startupFile(screen)} (${screen.devices})`);
  }
} finally {
  await browser.close();
}
