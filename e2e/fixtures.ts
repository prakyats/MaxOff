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


/** Throwaway probe (diag/hotfix-nav-bar-red*, never merged): a timeline printed per test. */
function diagProbe() {
  const w = window as unknown as { __diag?: unknown[] };
  const log: unknown[] = (w.__diag = []);
  const t = () => Math.round(performance.now());
  const html = () => document.documentElement;
  const where = () => location.pathname + location.search;
  const react = (el: Element | null) => {
    for (let n = el; n; n = n.parentElement) {
      if (Object.keys(n).some((k) => k.startsWith("__reactProps$"))) return true;
    }
    return false;
  };
  window.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      log.push({
        t: t(),
        what: "click",
        slot: target?.closest("[data-slot]")?.getAttribute("data-slot") ?? null,
        text: (target?.textContent ?? "").trim().slice(0, 30),
        react: react(target),
        chrome: html()?.getAttribute("data-chrome") ?? null,
        pending: html()?.hasAttribute("data-nav-pending") ?? null,
        url: where(),
        label: document.querySelector('[data-slot="calendar-month-label"]')?.textContent ?? null,
      });
    },
    true,
  );
  for (const name of ["DOMContentLoaded", "load"]) {
    window.addEventListener(name, () => log.push({ t: t(), what: name }));
  }
  window.addEventListener("popstate", () => log.push({ t: t(), what: "popstate", url: where() }));
  new MutationObserver((changes) => {
    for (const change of changes) {
      const el = change.target as Element;
      if (el !== document.documentElement) continue;
      log.push({
        t: t(),
        what: change.attributeName,
        value: el.getAttribute(change.attributeName ?? ""),
        url: where(),
      });
    }
  }).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-nav-pending", "data-chrome"],
  });
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (data, unused, url) {
    log.push({ t: t(), what: "push", url: url ? String(url) : null, na: !!(data && (data as Record<string, unknown>).__NA) });
    return push.call(this, data, unused, url);
  };
  history.replaceState = function (data, unused, url) {
    log.push({ t: t(), what: "replace", url: url ? String(url) : null, na: !!(data && (data as Record<string, unknown>).__NA) });
    return replace.call(this, data, unused, url);
  };
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const request = input instanceof Request ? input : null;
    const headers = new Headers(init?.headers ?? request?.headers);
    const method = init?.method ?? request?.method ?? "GET";
    const kind = headers.has("next-action")
      ? "action"
      : headers.get("rsc") === "1"
        ? headers.has("next-router-prefetch")
          ? "prefetch"
          : "rsc"
        : null;
    const answer = realFetch.call(this, input, init);
    if (kind && kind !== "prefetch") {
      const u = new URL(request?.url ?? String(input), location.href);
      u.searchParams.delete("_rsc");
      const to = u.pathname + u.search;
      log.push({ t: t(), what: kind, method, to });
      answer.then(
        () => log.push({ t: t(), what: `${kind}-answer`, to }),
        () => log.push({ t: t(), what: `${kind}-failed`, to }),
      );
    }
    return answer;
  };
}

export const test = base.extend<{
  onePrimaryPerLayer: void;
  documentLoads: DocumentLoadsPolicy;
  /** The reload guard (`document-loads.ts`); a test that knows a load is coming calls `allow`. */
  reloadGuard: DocumentLoadWatcher;
  noSurpriseDocumentLoads: void;
  diagTimeline: void;
}>({
  diagTimeline: [
    async ({ page }, use, info) => {
      await page.addInitScript(diagProbe);
      // Diag -3: no throttling; the scripts a page asks for after its load event are logged, and
      // held 1.5 s in the two reload-then-tap tests (hydration comes after load).
      const rate = 1;
      const hold = /Save waits|the band returns/.test(info.title);
      let loaded = false;
      const afterLoad: string[] = [];
      page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loaded = false;
      });
      page.on("load", () => {
        loaded = true;
        afterLoad.push("--load--");
      });
      await page.route("**/_next/static/**", async (route) => {
        if (loaded) {
          afterLoad.push(route.request().url().split("/").pop() ?? "");
          if (hold) await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        await route.continue().catch(() => undefined);
      });
      await use();
      console.log(`DIAG-AFTERLOAD ${info.project.name} ${info.title.slice(0, 40)} #${info.repeatEachIndex} hold=${hold} ${JSON.stringify(afterLoad)}`);
      if (info.status !== info.expectedStatus || info.repeatEachIndex < 2) {
        const timeline = await page
          .evaluate(() => (window as unknown as { __diag?: unknown[] }).__diag ?? [])
          .catch(() => ["(page gone)"]);
        console.log(
          `DIAG ${info.status} ${info.project.name} ${info.title.slice(0, 40)} #${info.repeatEachIndex} rate=${rate} ${JSON.stringify(timeline.slice(-90))}`,
        );
      }
    },
    { auto: true },
  ],
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
