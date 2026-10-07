// The push notification's large picture (owner decision 2026-10-02): one image per group of
// notification kinds, in public/icons/notify/ (SVG source + 192px PNG). The service worker maps a
// payload's group to one of these fixed same-origin paths (public/sw.js), never a URL from data.
// MaxOff red on a plain round background, legible at 48px and on dark and light notification
// shades; the glyphs are Lucide's (ISC licence, the app's own icon set). Run after changing them:
//   node scripts/generate-notify-icons.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons", "notify");
const lucide = path.join(root, "node_modules", "lucide-react", "dist", "esm", "icons");

const RED = "#C42126";
/** A pale rose disc: the red glyph reads on it, and the disc reads on a dark or a light shade. */
const DISC = "#FDECEC";
const SIZE = 192;
/** The glyph's box inside the disc, and its stroke (Lucide draws at 2 on 24). */
const GLYPH = 112;
const STROKE = 2.25;

/** The groups the dispatcher sends (`notifyGroupFor`, push/groups.ts) and their glyphs. */
const GROUPS = [
  { group: "tasks", icon: "clipboard-check" },
  { group: "approvals", icon: "badge-check" },
  { group: "leave", icon: "calendar-days" },
  { group: "reminders", icon: "alarm-clock" },
  { group: "other", icon: "inbox" },
];

/** Lucide's element list for an icon: the module's own exported `__iconData.node`. */
async function lucideNodes(name) {
  const icon = await import(pathToFileURL(path.join(lucide, `${name}.mjs`)).href);
  if (!icon.__iconData?.node) throw new Error(`no icon data in ${name}.mjs`);
  return icon.__iconData.node;
}

function element([tag, attrs]) {
  const list = Object.entries(attrs)
    .filter(([key]) => key !== "key")
    .map(([key, value]) => `${key}="${String(value).replaceAll('"', "&quot;")}"`)
    .join(" ");
  return `<${tag} ${list}/>`;
}

function svgFor(nodes) {
  const scale = GLYPH / 24;
  const offset = (SIZE - GLYPH) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="${DISC}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${RED}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
    ${nodes.map(element).join("\n    ")}
  </g>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { group, icon } of GROUPS) {
    const svg = svgFor(await lucideNodes(icon));
    await writeFile(path.join(outDir, `${group}.svg`), svg);
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
    );
    await writeFile(
      path.join(outDir, `${group}.png`),
      await page.screenshot({ omitBackground: true, type: "png" }),
    );
    await page.close();
    console.warn(`wrote public/icons/notify/${group}.{svg,png} (${icon})`);
  }
} finally {
  await browser.close();
}
