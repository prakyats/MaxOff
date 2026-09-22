// Renders public/icons/icon.svg into the PNG sizes the manifest and iOS need, using the
// Chromium that Playwright already installs. Run after changing the SVG:
//   node scripts/generate-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const iconsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = await readFile(path.join(iconsDir, "icon.svg"), "utf8");

// Maskable icons are cropped by the platform (a circle on Android), so the mark sits in the
// central 80% on a full-bleed square with no rounded corners. Apple icons are masked by iOS.
const fullBleed = svg
  .replace(/rx="\d+"/, 'rx="0"')
  .replace("<path ", '<path transform="translate(256 256) scale(0.8) translate(-256 -256)" ');

/** @type {Array<{ file: string; size: number; source: string }>} */
const outputs = [
  { file: "icon-192.png", size: 192, source: svg },
  { file: "icon-512.png", size: 512, source: svg },
  { file: "icon-maskable-512.png", size: 512, source: fullBleed },
  { file: "apple-touch-icon.png", size: 180, source: fullBleed },
];

await mkdir(iconsDir, { recursive: true });
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
} finally {
  await browser.close();
}
