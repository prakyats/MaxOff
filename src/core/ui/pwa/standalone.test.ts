import { describe, expect, it } from "vitest";

import {
  STANDALONE_SCRIPT,
  SYSTEM_TEXT_ATTRIBUTE,
  ZOOM_LOCK_ATTRIBUTE,
  ZOOM_LOCK_VIEWPORT,
} from "./standalone";

const DECLARED = "width=device-width, initial-scale=1, viewport-fit=cover";

type Run = {
  locked: boolean;
  appended: { name: string; content: string }[];
  /** The root's inline font size ("" when none). */
  fontSize: () => string;
  /** The system text attribute's value, or null. */
  systemText: () => string | null;
  /** Fires a `visibilitychange` with the page visible (the app back in the foreground). */
  foreground: () => void;
  /** The probe is gone again after every read. */
  probesLeft: () => number;
};

/**
 * Runs the head script against a fake window: whether it locked, the metas it appended, and the
 * root's font size. `iosBody` is what WebKit computes for `font: -apple-system-body` (iOS's text
 * size setting); `null` stands for a WebKit that cannot opt in.
 */
function run({
  standalone = false,
  ios = false,
  iosBody = 17 as number | null,
  declared = DECLARED as string | null,
}: {
  standalone?: boolean;
  ios?: boolean;
  iosBody?: number | null;
  declared?: string | null;
}): Run & { setIosBody: (px: number) => void } {
  const attributes = new Map<string, string>();
  const appended: { name: string; content: string }[] = [];
  const listeners: Array<() => void> = [];
  const style = { fontSize: "" };
  let body = iosBody;
  let probes = 0;
  const window = {
    matchMedia: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
    // Only iOS has the property at all, installed or not.
    navigator: ios ? { standalone } : {},
    CSS: {
      supports: (property: string, value: string) =>
        ios && body !== null && property === "font" && value === "-apple-system-body",
    },
    getComputedStyle: (element: { style: { cssText: string } }) => ({
      fontSize: element.style.cssText.includes("-apple-system-body") ? `${body ?? 16}px` : "16px",
    }),
  };
  const document = {
    visibilityState: "visible",
    documentElement: {
      style,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      appendChild: () => (probes += 1),
      removeChild: () => (probes -= 1),
    },
    querySelector: () => (declared === null ? null : { content: declared }),
    createElement: () => ({
      name: "",
      content: "",
      style: { cssText: "" },
      setAttribute: () => {},
    }),
    head: {
      appendChild: (meta: { name: string; content: string }) => appended.push(meta),
      removeChild: (meta: { name: string; content: string }) =>
        appended.splice(appended.indexOf(meta), 1),
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "visibilitychange") listeners.push(listener);
    },
  };
  new Function("window", "document", STANDALONE_SCRIPT)(window, document);
  return {
    // Read when asked: a later read of the text size can lock or unlock.
    get locked() {
      return attributes.has(ZOOM_LOCK_ATTRIBUTE);
    },
    get appended() {
      return appended.map(({ name, content }) => ({ name, content }));
    },
    fontSize: () => style.fontSize,
    systemText: () => attributes.get(SYSTEM_TEXT_ATTRIBUTE) ?? null,
    foreground: () => listeners.forEach((listener) => listener()),
    probesLeft: () => probes,
    setIosBody: (px: number) => {
      body = px;
    },
  };
}

const LOCKED_VIEWPORT = [{ name: "viewport", content: `${DECLARED}, ${ZOOM_LOCK_VIEWPORT}` }];

describe("zoom lock (ARCHITECTURE §14.2 i, 2.7b)", () => {
  it("locks the installed Android app: the declared viewport plus no zoom, appended last", () => {
    const { locked, appended, fontSize } = run({ standalone: true });
    expect(locked).toBe(true);
    expect(appended).toEqual(LOCKED_VIEWPORT);
    // Android's Chrome scales the text itself: the root is left alone.
    expect(fontSize()).toBe("");
  });

  it("leaves a browser tab zoomable, on any phone, at the browser's own text size", () => {
    for (const ios of [false, true]) {
      const tab = run({ standalone: false, ios });
      expect(tab.locked).toBe(false);
      expect(tab.appended).toEqual([]);
      expect(tab.fontSize()).toBe("");
    }
  });

  it("still locks with a sane viewport when none was declared", () => {
    const { appended } = run({ standalone: true, declared: null });
    expect(appended[0]?.content).toBe(`width=device-width, initial-scale=1, ${ZOOM_LOCK_VIEWPORT}`);
  });

  it("never throws", () => {
    expect(() => new Function("window", "document", STANDALONE_SCRIPT)({}, {})).not.toThrow();
  });
});

describe("iOS system text size (6.6, Kickoff 6 decision 20)", () => {
  it("follows the iPhone's text size in the installed app, then locks it", () => {
    // iOS's sizes for body text: Large (default) 17, xL 19, xxL 21, xxxL 23.
    const cases: Array<[number, string]> = [
      [17, ""],
      [19, "111.8%"],
      [21, "123.5%"],
      [23, "135.3%"],
    ];
    for (const [px, root] of cases) {
      const app = run({ standalone: true, ios: true, iosBody: px });
      expect(app.fontSize(), `root at ${px}px body text`).toBe(root);
      expect(app.locked, `locked at ${px}px`).toBe(true);
      expect(app.appended).toEqual(LOCKED_VIEWPORT);
      expect(app.probesLeft()).toBe(0);
    }
  });

  it("keeps the design's size at smaller text and stops at 200% at the accessibility sizes", () => {
    expect(run({ standalone: true, ios: true, iosBody: 14 }).fontSize()).toBe("");
    expect(run({ standalone: true, ios: true, iosBody: 15 }).systemText()).toBe("100");
    expect(run({ standalone: true, ios: true, iosBody: 33 }).fontSize()).toBe("194.1%");
    expect(run({ standalone: true, ios: true, iosBody: 53 }).fontSize()).toBe("200%");
  });

  it("locks only within 100–200%: above it the root stops at 200% and pinch-zoom stays", () => {
    // 34px is exactly 200%: still the tested range, locked.
    const top = run({ standalone: true, ios: true, iosBody: 34 });
    expect(top.fontSize()).toBe("200%");
    expect(top.locked).toBe(true);
    expect(top.appended).toEqual(LOCKED_VIEWPORT);
    // iOS's larger accessibility sizes: more than the app's tested maximum, so the person can
    // still pinch for the rest (advisor, 2026-10-08, decision 20).
    for (const px of [35, 44, 53]) {
      const app = run({ standalone: true, ios: true, iosBody: px });
      expect(app.fontSize(), `root at ${px}px body text`).toBe("200%");
      expect(app.systemText()).toBe("200");
      expect(app.locked, `not locked at ${px}px`).toBe(false);
      expect(app.appended).toEqual([]);
    }
  });

  it("unlocks and locks again as the setting crosses 200% between visits", () => {
    const app = run({ standalone: true, ios: true, iosBody: 23 });
    expect(app.locked).toBe(true);
    app.setIosBody(53);
    app.foreground();
    expect(app.fontSize()).toBe("200%");
    expect(app.locked).toBe(false);
    expect(app.appended).toEqual([]);
    app.setIosBody(21);
    app.foreground();
    expect(app.fontSize()).toBe("123.5%");
    expect(app.locked).toBe(true);
    // One locked copy, never a pile of them.
    expect(app.appended).toEqual(LOCKED_VIEWPORT);
    app.foreground();
    expect(app.appended).toEqual(LOCKED_VIEWPORT);
  });

  it("reads the setting again when the app comes back to the foreground", () => {
    const app = run({ standalone: true, ios: true, iosBody: 17 });
    expect(app.fontSize()).toBe("");
    app.setIosBody(23);
    app.foreground();
    expect(app.fontSize()).toBe("135.3%");
    expect(app.systemText()).toBe("135.3");
    app.setIosBody(17);
    app.foreground();
    expect(app.fontSize()).toBe("");
    expect(app.probesLeft()).toBe(0);
  });

  it("keeps pinch-zoom where the text size cannot reach the app", () => {
    const cannot = run({ standalone: true, ios: true, iosBody: null });
    expect(cannot.locked).toBe(false);
    expect(cannot.appended).toEqual([]);
    expect(cannot.fontSize()).toBe("");
    expect(cannot.systemText()).toBeNull();
  });
});
