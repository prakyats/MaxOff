import { test as base, expect } from "@playwright/test";

import { DocumentLoadWatcher, type DocumentLoadsPolicy } from "./document-loads";

/**
 * The action colour rule's e2e half (ARCHITECTURE §14.1): **at most one visible solid red commit
 * action (`[data-variant="primary"]`) per layer, and never beside a neutral solid one
 * (`[data-variant="strong"]`)**: one solid button per layer when red is on it (Kickoff 4 decision
 * 26: "no second solid button"). A layer is the screen, each dialog, each sheet and each sticky
 * action bar **while it floats** (`position: fixed`, a phone): from `md` up `StickyActions` is the
 * form's last row, part of the screen, not a layer (phase 4 review A-M1). Every spec imports
 * `test` from here, so every layer any spec opens is watched, not a hand-picked list: a watcher
 * installed before the page's own scripts checks on every DOM change and records a violation; the
 * test fails at its end if any occurred.
 */
declare global {
  interface Window {
    __primaryViolations?: string[];
  }
}

function watchPrimaries() {
  const DIALOGS = '[role="dialog"], [role="alertdialog"]';
  const found = new Set<string>();
  window.__primaryViolations = [];
  const visible = (el: Element) =>
    (el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
  const label = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ");
  // The nearest layer: a floating sticky bar inside the nearest dialog (or the screen), else that
  // dialog, else the screen.
  const layerOf = (button: Element): Element | null => {
    const dialog = button.closest(DIALOGS);
    let bar = button.closest('[data-slot="sticky-actions"]');
    while (bar && (!dialog || dialog.contains(bar))) {
      if (getComputedStyle(bar).position === "fixed") return bar;
      bar = bar.parentElement?.closest('[data-slot="sticky-actions"]') ?? null;
    }
    return dialog;
  };
  const check = () => {
    const solids = [
      ...document.querySelectorAll('[data-variant="primary"], [data-variant="strong"]'),
    ].filter(visible);
    const byLayer = new Map<string, { primary: string[]; strong: string[] }>();
    for (const button of solids) {
      const layer = layerOf(button);
      const name = layer
        ? `${layer.getAttribute("role") ?? layer.getAttribute("data-slot")}: ${label(
            layer.querySelector("h2, [data-slot$='title']") ?? layer,
          ).slice(0, 60)}`
        : `screen ${location.pathname}`;
      const entry = byLayer.get(name) ?? { primary: [], strong: [] };
      entry[button.getAttribute("data-variant") === "primary" ? "primary" : "strong"].push(
        label(button),
      );
      byLayer.set(name, entry);
    }
    for (const [layer, { primary, strong }] of byLayer) {
      if (primary.length < 2 && (primary.length === 0 || strong.length === 0)) continue;
      const entry = `${layer} → ${[...primary, ...strong.map((text) => `${text} (strong)`)].join(" | ")}`;
      if (!found.has(entry)) {
        found.add(entry);
        window.__primaryViolations!.push(entry);
      }
    }
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      check();
    });
  };
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-state", "hidden", "style", "class", "open", "aria-hidden"],
  });
}

export const test = base.extend<{
  onePrimaryPerLayer: void;
  documentLoads: DocumentLoadsPolicy;
  /** The reload guard (`document-loads.ts`); a test that knows a load is coming calls `allow`. */
  reloadGuard: DocumentLoadWatcher;
  noSurpriseDocumentLoads: void;
}>({
  /** "none" (the default): a document load the test did not ask for fails it (`document-loads.ts`). */
  documentLoads: ["none", { option: true }],
  reloadGuard: async ({ context }, provide) => {
    await provide(await DocumentLoadWatcher.install(context));
  },
  noSurpriseDocumentLoads: [
    async ({ reloadGuard, documentLoads }, use) => {
      await use();
      const reports = await reloadGuard.report();
      if (documentLoads === "allowed") return;
      expect(reports, "no document load the test did not ask for").toEqual([]);
    },
    { auto: true },
  ],
  onePrimaryPerLayer: [
    async ({ page }, use) => {
      await page.addInitScript(watchPrimaries);
      await use();
      const violations = await page
        .evaluate(() => window.__primaryViolations ?? [])
        .catch(() => [] as string[]);
      expect(
        violations,
        "one solid red commit per layer, never beside a second solid button",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
