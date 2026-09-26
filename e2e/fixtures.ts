import { test as base, expect } from "@playwright/test";

/**
 * The action colour rule's e2e half (ARCHITECTURE §14.1): **at most one visible solid red commit
 * action (`[data-variant="primary"]`) per layer**, where a layer is the screen, each dialog, each
 * sheet and each sticky action bar. Every spec imports `test` from here, so every layer any spec
 * opens is watched, not a hand-picked list: a watcher installed before the page's own scripts
 * checks on every DOM change and records a violation; the test fails at its end if any occurred.
 */
declare global {
  interface Window {
    __primaryViolations?: string[];
  }
}

function watchPrimaries() {
  const LAYERS = '[role="dialog"], [role="alertdialog"], [data-slot="sticky-actions"]';
  const found = new Set<string>();
  window.__primaryViolations = [];
  const visible = (el: Element) =>
    (el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
  const label = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const check = () => {
    const primaries = [...document.querySelectorAll('[data-variant="primary"]')].filter(visible);
    const byLayer = new Map<string, string[]>();
    for (const button of primaries) {
      const layer = button.closest(LAYERS);
      const name = layer
        ? `${layer.getAttribute("role") ?? layer.getAttribute("data-slot")}: ${label(
            layer.querySelector("h2, [data-slot$='title']") ?? layer,
          ).slice(0, 60)}`
        : `screen ${location.pathname}`;
      byLayer.set(name, [...(byLayer.get(name) ?? []), label(button)]);
    }
    for (const [layer, labels] of byLayer) {
      if (labels.length < 2) continue;
      const entry = `${layer} → ${labels.join(" | ")}`;
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

export const test = base.extend<{ onePrimaryPerLayer: void }>({
  onePrimaryPerLayer: [
    async ({ page }, use) => {
      await page.addInitScript(watchPrimaries);
      await use();
      const violations = await page
        .evaluate(() => window.__primaryViolations ?? [])
        .catch(() => [] as string[]);
      expect(violations, "at most one solid red commit action per layer").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
