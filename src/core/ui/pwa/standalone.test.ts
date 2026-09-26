import { describe, expect, it } from "vitest";

import { STANDALONE_SCRIPT, ZOOM_LOCK_ATTRIBUTE, ZOOM_LOCK_VIEWPORT } from "./standalone";

const DECLARED = "width=device-width, initial-scale=1, viewport-fit=cover";

/** Runs the head script against a fake window: whether it locked, and the metas it appended. */
function run({
  standalone = false,
  ios = false,
  declared = DECLARED as string | null,
}: {
  standalone?: boolean;
  ios?: boolean;
  declared?: string | null;
}): { locked: boolean; appended: { name: string; content: string }[] } {
  const attributes = new Set<string>();
  const appended: { name: string; content: string }[] = [];
  const window = {
    matchMedia: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
    // Only iOS has the property at all, installed or not.
    navigator: ios ? { standalone } : {},
  };
  const document = {
    documentElement: { setAttribute: (name: string) => attributes.add(name) },
    querySelector: () => (declared === null ? null : { content: declared }),
    createElement: () => {
      const meta = { name: "", content: "", setAttribute: () => {} };
      return meta;
    },
    head: {
      appendChild: ({ name, content }: { name: string; content: string }) =>
        appended.push({ name, content }),
    },
  };
  new Function("window", "document", STANDALONE_SCRIPT)(window, document);
  return { locked: attributes.has(ZOOM_LOCK_ATTRIBUTE), appended };
}

describe("zoom lock (ARCHITECTURE §14.2 i, 2.7b)", () => {
  it("locks the installed Android app: the declared viewport plus no zoom, appended last", () => {
    const { locked, appended } = run({ standalone: true });
    expect(locked).toBe(true);
    expect(appended).toEqual([{ name: "viewport", content: `${DECLARED}, ${ZOOM_LOCK_VIEWPORT}` }]);
  });

  it("leaves an installed iPhone app zoomable: iOS text size does not reach it yet", () => {
    expect(run({ standalone: true, ios: true })).toEqual({ locked: false, appended: [] });
  });

  it("leaves a browser tab zoomable, on any phone", () => {
    expect(run({ standalone: false })).toEqual({ locked: false, appended: [] });
    expect(run({ standalone: false, ios: true })).toEqual({ locked: false, appended: [] });
  });

  it("still locks with a sane viewport when none was declared", () => {
    const { appended } = run({ standalone: true, declared: null });
    expect(appended[0]?.content).toBe(`width=device-width, initial-scale=1, ${ZOOM_LOCK_VIEWPORT}`);
  });

  it("never throws", () => {
    expect(() => new Function("window", "document", STANDALONE_SCRIPT)({}, {})).not.toThrow();
  });
});
