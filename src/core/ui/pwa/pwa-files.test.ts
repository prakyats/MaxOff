import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { THEME_COLOR_SCRIPT, THEME_COLORS } from "../theme/theme-color";

/**
 * The PWA files live in public/ with no build step, so this test keeps them consistent with
 * each other and with the design tokens (ARCHITECTURE §14, §3.3).
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const publicDir = path.join(root, "public");
const manifest = JSON.parse(readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8")) as {
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};
const sw = readFileSync(path.join(publicDir, "sw.js"), "utf8");
const headers = readFileSync(path.join(publicDir, "_headers"), "utf8");
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");

function token(selector: string, name: string): string | undefined {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("\n}", start));
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];
}

describe("manifest.webmanifest", () => {
  it("installs at the root in standalone mode", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("takes both colours from the DARK token, so the splash hands off invisibly", () => {
    // They differ on purpose (owner decision 2026-09-23, confirmed on an S23). An installed PWA
    // takes its band from the manifest, and a manifest has one theme_color that cannot vary by
    // colour scheme — so the media-query pair that fixes Chrome's tab toolbar cannot reach it.
    // Dark wins because the app is dark-first on phones: a dark band above a light app reads as
    // an intentional header, a light band above a dark app reads as broken. Chrome picks the
    // glyph colour from this value's luminance, so the status bar stays readable either way.
    // background_color paints the Android splash. It was the light token, which meant a white
    // splash handing over to a dark app — the flash the band fix was supposed to end (owner
    // decision 2026-09-23, round 4). Both are dark now, so the hand-off is invisible.
    expect(manifest.theme_color).toBe(token(".dark", "background"));
    expect(manifest.theme_color).toBe(THEME_COLORS.dark);
    expect(manifest.background_color).toBe(token(".dark", "background"));
    expect(manifest.background_color).toBe(THEME_COLORS.dark);
  });

  it("names icons that exist, including a maskable one", () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      expect(existsSync(path.join(publicDir, icon.src)), icon.src).toBe(true);
    }
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
  });

  it("uses the logo red in the icon source", () => {
    const svg = readFileSync(path.join(publicDir, "icons/icon.svg"), "utf8");
    expect(svg).toContain(`fill="${token(":root", "logo")}"`);
  });
});

describe("theme-color", () => {
  it("declares both a light and a dark entry", () => {
    // A single light value left the status-bar band white above a dark screen (task 1.5).
    expect(layout).toContain("(prefers-color-scheme: light)");
    expect(layout).toContain("(prefers-color-scheme: dark)");
    expect(layout).toContain("THEME_COLORS.light");
    expect(layout).toContain("THEME_COLORS.dark");
  });

  it("uses the page background tokens exactly, not approximations of them", () => {
    expect(THEME_COLORS.light).toBe(token(":root", "background"));
    expect(THEME_COLORS.dark).toBe(token(".dark", "background"));
  });

  it("follows an explicit theme choice, which the media queries cannot", () => {
    // prefers-color-scheme follows the OS; picking Dark in-app has to rewrite the meta.
    expect(THEME_COLOR_SCRIPT).toContain('meta[name="theme-color"]');
    expect(THEME_COLOR_SCRIPT).toContain(THEME_COLORS.dark);
    expect(THEME_COLOR_SCRIPT).toContain(THEME_COLORS.light);
    expect(layout).toContain("ThemeColorMeta");
    expect(layout).toContain("THEME_COLOR_SCRIPT");
  });

  it("keeps the iOS status bar readable in light mode", () => {
    // black-translucent forces white glyphs, unreadable on #fafaf9 (owner decision 2026-09-23).
    expect(layout).toContain('statusBarStyle: "default"');
  });
});

describe("sw.js", () => {
  it("precaches the offline page and the page exists", () => {
    expect(sw).toMatch(/OFFLINE_URL = "\/offline"/);
    expect(existsSync(path.join(root, "src/app/offline/page.tsx"))).toBe(true);
  });

  it("never intercepts API calls, other origins or non-GET requests", () => {
    expect(sw).toContain('request.method !== "GET"');
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).toContain("url.origin !== self.location.origin");
  });

  it("is served without caching so a new version is picked up", () => {
    expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
  });

  it("never caches the manifest, at either layer", () => {
    // A cached manifest cannot reach an installed app, and the failure is invisible: the app
    // just keeps the old name, icons and band. This cost four rounds of debugging in 1.5.
    expect(sw).not.toMatch(/PRECACHE\s*=\s*\[[^\]]*manifest/);
    expect(headers).toMatch(/\/manifest\.webmanifest\n\s+Cache-Control: no-cache/);
    expect(headers).not.toMatch(/\/manifest\.webmanifest\n\s+Cache-Control:[^\n]*max-age=[1-9]/);
  });

  it("treats only content-hashed files as immutable", () => {
    // /icons names are stable (icon-192.png), so cache-first would pin a changed icon for ever.
    const immutable = sw.match(/function isImmutableAsset\([\s\S]*?\n}/)?.[0] ?? "";
    expect(immutable).toContain("/_next/static/");
    expect(immutable).not.toContain("/icons/");
    expect(sw).toContain("isRevalidatingAsset");
    expect(headers).toMatch(/\/icons\/\*\n\s+Cache-Control:[^\n]*must-revalidate/);
  });
});
