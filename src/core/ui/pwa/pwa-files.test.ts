import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");

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

  it("uses the light background token for its colours", () => {
    const background = token(":root", "background");
    expect(background).toBeDefined();
    expect(manifest.theme_color).toBe(background);
    expect(manifest.background_color).toBe(background);
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
    const headers = readFileSync(path.join(publicDir, "_headers"), "utf8");
    expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
  });
});
