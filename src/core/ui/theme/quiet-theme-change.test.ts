import { afterEach, describe, expect, it, vi } from "vitest";

import { QUIET_THEME_ATTRIBUTE, quietThemeChanges } from "./quiet-theme-change";

/** A stand-in `<html>`, `document` and `MutationObserver`: `mutate` runs the observer's callback. */
function setup(initial: string[]) {
  const classes = new Set(initial);
  const attributes = new Map<string, string>();
  const root = {
    classList: { contains: (name: string) => classes.has(name) },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as HTMLElement;
  const events: string[] = [];
  const timers: (() => void)[] = [];
  let callback: (() => void) | null = null;
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(run: () => void) {
        callback = run;
      }
      observe(_: unknown, options: MutationObserverInit) {
        events.push(`observe ${options.attributeFilter?.join(",")}`);
      }
      disconnect() {
        events.push("disconnect");
      }
    },
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      textContent: "",
      remove() {
        events.push("release");
      },
    }),
    head: { append: (style: { textContent: string }) => events.push(`hold ${style.textContent}`) },
    body: {},
  });
  vi.stubGlobal("window", {
    getComputedStyle: () => events.push("restyle"),
    setTimeout: (run: () => void) => timers.push(run),
  });
  const mutate = (next: string[]) => {
    classes.clear();
    for (const name of next) classes.add(name);
    callback?.();
  };
  return { root, events, timers, attributes, mutate };
}

afterEach(() => vi.unstubAllGlobals());

describe("quietThemeChanges", () => {
  it("holds transitions for a change between light and dark, then releases them", () => {
    const { root, events, timers, mutate } = setup(["light"]);
    quietThemeChanges(root);
    mutate(["dark"]);
    expect(events).toEqual([
      "observe class",
      "hold *,*::before,*::after{transition:none!important}",
      "restyle",
    ]);
    timers.forEach((run) => run());
    expect(events.at(-1)).toBe("release");
    mutate(["light"]);
    expect(events.filter((event) => event.startsWith("hold"))).toHaveLength(2);
  });

  it("does nothing when the same theme is applied again (next-themes' mount, other classes)", () => {
    const { root, events, mutate } = setup(["light"]);
    quietThemeChanges(root);
    mutate(["light"]);
    mutate(["light", "antialiased"]);
    expect(events).toEqual(["observe class"]);
  });

  it("marks <html> while it watches, and stops on the disconnect", () => {
    const { root, events, attributes } = setup(["dark"]);
    const stop = quietThemeChanges(root);
    expect(attributes.has(QUIET_THEME_ATTRIBUTE)).toBe(true);
    stop();
    expect(attributes.has(QUIET_THEME_ATTRIBUTE)).toBe(false);
    expect(events.at(-1)).toBe("disconnect");
  });
});
