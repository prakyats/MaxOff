import { describe, expect, it } from "vitest";

import { THEME_COLOR_SCRIPT, THEME_COLORS, THEME_STORAGE_KEY } from "./theme-color";

/**
 * The pre-paint script decides the theme before anything is painted, so a mistake in it is a
 * visible flash on every cold start of the installed app. The previous version returned early
 * for the default `system` and never touched the class, which is exactly what the flash was.
 *
 * This runs the real script text against a stub document — no browser, no frame timing, no
 * throttling. A Playwright trace of the first 500 ms turned out not to be dependable enough to
 * gate a build on (see PROGRESS); this is, because it tests the decision rather than the paint.
 * `e2e/theme-flash.spec.ts` still asserts the script is in `<head>`, which is the other half.
 */

interface FakeMeta {
  name: string;
  content: string;
  media?: string | undefined;
}

function run({ stored, osDark }: { stored: string | null; osDark: boolean }) {
  const classes = new Set<string>();
  const style: { colorScheme?: string } = {};
  const metas: FakeMeta[] = [
    { name: "theme-color", content: THEME_COLORS.light, media: "(prefers-color-scheme: light)" },
    { name: "theme-color", content: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
  ];

  const documentStub = {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      style,
    },
    querySelectorAll: () =>
      metas.map((meta) => ({
        setAttribute: (key: string, value: string) => {
          if (key === "content") meta.content = value;
        },
        removeAttribute: (key: string) => {
          if (key === "media") meta.media = undefined;
        },
      })),
  };

  const windowStub = {
    matchMedia: (query: string) => ({ matches: osDark && query.includes("dark") }),
  };

  const localStorageStub = {
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null),
  };

  new Function("document", "window", "localStorage", THEME_COLOR_SCRIPT)(
    documentStub,
    windowStub,
    localStorageStub,
  );

  return { dark: classes.has("dark"), colorScheme: style.colorScheme, metas };
}

describe("the pre-paint theme script", () => {
  it("follows the OS when the setting is system (the default, and the flash that was reported)", () => {
    expect(run({ stored: "system", osDark: true }).dark).toBe(true);
    expect(run({ stored: "system", osDark: false }).dark).toBe(false);
  });

  it("treats a missing or unknown value as system, not as light", () => {
    // Nothing is written to localStorage until the theme is changed by hand, so a fresh install
    // on a dark phone takes this path — and the old script returned early right here.
    expect(run({ stored: null, osDark: true }).dark).toBe(true);
    expect(run({ stored: "nonsense", osDark: true }).dark).toBe(true);
  });

  it("honours an explicit choice over the OS, in both directions", () => {
    expect(run({ stored: "dark", osDark: false }).dark).toBe(true);
    expect(run({ stored: "light", osDark: true }).dark).toBe(false);
  });

  it("sets color-scheme too, so form controls and scrollbars match", () => {
    expect(run({ stored: "dark", osDark: false }).colorScheme).toBe("dark");
    expect(run({ stored: "light", osDark: true }).colorScheme).toBe("light");
  });

  it("rewrites every theme-color meta and drops their media queries", () => {
    // The media pair follows the OS, so an explicit choice has to override both entries.
    const { metas } = run({ stored: "dark", osDark: false });
    expect(metas.map((meta) => meta.content)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
    expect(metas.every((meta) => meta.media === undefined)).toBe(true);
  });

  it("never throws when storage is unavailable", () => {
    // Private windows and blocked site data: a throw here would leave the page unthemed.
    const boom = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() =>
      new Function("document", "window", "localStorage", THEME_COLOR_SCRIPT)(
        {
          documentElement: { classList: { toggle: () => {} }, style: {} },
          querySelectorAll: () => [],
        },
        { matchMedia: () => ({ matches: false }) },
        boom,
      ),
    ).not.toThrow();
  });
});
