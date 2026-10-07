import { type BrowserContext, type Page, type Request } from "@playwright/test";

import { systemClock } from "../src/core/time";

/**
 * The reload guard (owner 2026-10-01, after two CI runs lost a view switch and a back slide to a
 * full page load): **a signed-in screen never loads a whole new document unless the test asked
 * for one.** A surprise document load on a phone is a lost scroll, a lost draft, a missing slide,
 * and until now it showed up only as some later assertion failing for an unrelated-looking reason
 * ("execution context was destroyed", an empty list of slides).
 *
 * How it tells the two apart: every main-frame navigation request is a document load; the ones
 * the test triggers itself (`page.goto`, `page.reload`, `page.goBack`/`goForward` across one, a
 * popup's first page) are counted as expected while that call is in flight. Everything else is
 * a surprise, and the test fails at its end naming each one, with what led up to it: the router
 * fetches and server actions of the last seconds, every console error, Next's own "Falling back
 * to browser navigation" line when its RSC fetch failed, and the last tap on a link (kept in
 * `sessionStorage`, so it survives the load it may have caused: a tap on a link the app had not
 * hydrated yet is answered by the head script with a full load, 2.8).
 *
 * Two loads are the app's own answer to the test's request and count as expected: the bounce to
 * `/forbidden` (a screen the role may not see redirects from inside the page, after the shell has
 * streamed, so Next finishes the redirect as a document load), and a load the test allowed
 * beforehand with `reloadGuard.allow(pattern)`, with its reason beside it (a tap before hydration
 * with the scripts held, the 25 s Retry). Specs whose whole flow loads documents on purpose
 * (sign-in and the one-time links, taps before hydration) opt out with
 * `test.use({ documentLoads: "allowed" })`.
 */
export type DocumentLoadsPolicy = "none" | "allowed";

type Event = { at: number; line: string };

const RECENT_MS = 8_000;
const TAP_TRACE_KEY = "__e2eLastTap";
/** The permission bounce: the server's answer to a request for a screen the role may not see. */
const BOUNCE = /\/forbidden(\?|$)/;

/** DIAG (diag/6a-bell-reload): the last link tap with React's state at it, and a timeline. */
function traceTaps() {
  const key = "__e2eLastTap";
  const timelineKey = "__e2eTimeline";
  const path = location.pathname;
  const mark = (line: string) => {
    try {
      const list = JSON.parse(sessionStorage.getItem(timelineKey) ?? "[]") as string[];
      list.push(`${path} +${Math.round(performance.now())}ms ${line}`);
      sessionStorage.setItem(timelineKey, JSON.stringify(list.slice(-80)));
    } catch {
      // Storage blocked: the trace is only a diagnostic.
    }
  };
  const reactKeys = (el: Element | null) =>
    el
      ? Object.keys(el)
          .filter((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"))
          .map((k) => k.slice(0, 13))
      : null;
  // The Suspense boundaries the element sits in, innermost first: React's comment markers
  // ($? pending, $ resolved, $! client-rendered), found walking back over closed siblings.
  const boundaries = (el: Element | null) => {
    const chain: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body) {
      let sib = node.previousSibling;
      let depth = 0;
      let found: string | null = null;
      while (sib) {
        if (sib.nodeType === 8) {
          const text = sib.nodeValue ?? "";
          if (text === "/$") depth += 1;
          else if (text.startsWith("$")) {
            if (depth === 0) {
              found = text;
              break;
            }
            depth -= 1;
          }
        }
        sib = sib.previousSibling;
      }
      if (found !== null)
        chain.push(`${node.tagName.toLowerCase()}[${node.getAttribute("data-slot") ?? ""}]:${found}`);
      node = node.parentElement;
    }
    return chain;
  };
  const pendingScripts = () => {
    const done = new Set(performance.getEntriesByType("resource").map((e) => e.name));
    return [...document.scripts]
      .filter((s) => s.src && !done.has(s.src))
      .map((s) => s.src.replace(/^.*\/_next\//, ""))
      .slice(0, 20);
  };
  const html = document.documentElement;
  const bell = () => document.querySelector('[data-slot="header-bell"]');
  const snapshot = (anchor: Element) => ({
    at: Math.round(performance.now()),
    href: anchor.getAttribute("href"),
    slot: anchor.getAttribute("data-slot"),
    live: anchor.hasAttribute("data-live"),
    hydrated: html.hasAttribute("data-chrome"),
    anchorReact: reactKeys(anchor),
    htmlReact: reactKeys(html),
    navPending: html.getAttribute("data-nav-pending"),
    navTarget: anchor.getAttribute("data-nav-target"),
    fallback: Boolean(document.querySelector('[data-slot="loading-my-day"]')),
    page: Boolean(document.querySelector('[data-slot="my-day"]')),
    pageReact: reactKeys(document.querySelector('[data-slot="my-day"]')),
    boundaries: boundaries(anchor),
    pendingScripts: pendingScripts(),
    readyState: document.readyState,
    text: (anchor.textContent ?? "").trim().slice(0, 40),
  });
  let last: (ReturnType<typeof snapshot> & { after?: unknown }) | null = null;
  let lastAnchor: Element | null = null;
  const save = () => {
    try {
      sessionStorage.setItem(key, JSON.stringify(last));
    } catch {
      // Storage blocked: the trace is only a diagnostic.
    }
  };
  window.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      lastAnchor = anchor;
      last = snapshot(anchor);
      save();
      mark(`tap ${last.slot ?? last.href} anchorReact=${JSON.stringify(last.anchorReact)}`);
    },
    true,
  );
  window.addEventListener(
    "click",
    (event) => {
      if (!last || !lastAnchor) return;
      last.after = {
        defaultPrevented: event.defaultPrevented,
        anchorReact: reactKeys(lastAnchor),
        fallback: Boolean(document.querySelector('[data-slot="loading-my-day"]')),
        page: Boolean(document.querySelector('[data-slot="my-day"]')),
        pageReact: reactKeys(document.querySelector('[data-slot="my-day"]')),
      };
      save();
      mark(`tap dispatched defaultPrevented=${event.defaultPrevented}`);
    },
    false,
  );
  const seen = new Set<string>();
  const first = (name: string, is: () => boolean) => {
    if (seen.has(name) || !is()) return;
    seen.add(name);
    mark(name);
  };
  const started = performance.now();
  const timer = setInterval(() => {
    try {
      first(`readyState=${document.readyState}`, () => true);
      first("data-chrome", () => html.hasAttribute("data-chrome"));
      first("html hydrated", () => (reactKeys(html)?.length ?? 0) > 0);
      first("fallback shown", () =>
        Boolean(document.querySelector('[data-slot="loading-my-day"]')),
      );
      first("page streamed", () => Boolean(document.querySelector('[data-slot="my-day"]')));
      first(
        "fallback gone",
        () => seen.has("fallback shown") && !document.querySelector('[data-slot="loading-my-day"]'),
      );
      first("bell present", () => Boolean(bell()));
      first("bell hydrated", () => (reactKeys(bell())?.length ?? 0) > 0);
      first(
        "page hydrated",
        () => (reactKeys(document.querySelector('[data-slot="my-day"]'))?.length ?? 0) > 0,
      );
      first("bell data-live", () => Boolean(bell()?.hasAttribute("data-live")));
      if (performance.now() - started > 8000) clearInterval(timer);
    } catch {
      clearInterval(timer);
    }
  }, 10);
}

export class DocumentLoadWatcher {
  private readonly events: Event[] = [];
  private readonly surprises: { at: number; url: string; page: Page }[] = [];
  private readonly expecting = new Map<Page, number>();
  private readonly allowed: RegExp[] = [];
  private readonly started = systemClock().getTime();

  constructor(private readonly context: BrowserContext) {
    for (const page of context.pages()) this.watch(page);
    context.on("page", (page) => this.watch(page));
  }

  /** Attached before any page: the tap trace for every document the context opens. */
  static async install(context: BrowserContext): Promise<DocumentLoadWatcher> {
    await context.addInitScript(traceTaps);
    return new DocumentLoadWatcher(context);
  }

  /** A document load the test knows is coming (with the reason beside the call). */
  allow(pattern: RegExp): void {
    this.allowed.push(pattern);
  }

  private note(line: string) {
    const at = systemClock().getTime();
    this.events.push({ at, line: `+${at - this.started}ms ${line}` });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  private watch(page: Page) {
    this.expecting.set(page, 0);
    // A popup's first document is the app's own `window.open` or `target="_blank"`: expected.
    let popupFirstLoad = page.opener() !== null || page.url() !== "about:blank";
    const expectAround = <T>(run: () => Promise<T>) => {
      this.expecting.set(page, (this.expecting.get(page) ?? 0) + 1);
      return run().finally(() => {
        // The navigation's requests have all been reported by the time its promise settles.
        this.expecting.set(page, (this.expecting.get(page) ?? 1) - 1);
      });
    };
    const originalGoto = page.goto.bind(page);
    page.goto = (url, options) => expectAround(() => originalGoto(url, options));
    const originalReload = page.reload.bind(page);
    page.reload = (options) => expectAround(() => originalReload(options));
    const originalBack = page.goBack.bind(page);
    page.goBack = (options) => expectAround(() => originalBack(options));
    const originalForward = page.goForward.bind(page);
    page.goForward = (options) => expectAround(() => originalForward(options));

    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        const url = request.url();
        const expected =
          (this.expecting.get(page) ?? 0) > 0 ||
          popupFirstLoad ||
          BOUNCE.test(url) ||
          this.allowed.some((pattern) => pattern.test(url));
        popupFirstLoad = false;
        this.note(
          `DOCUMENT ${request.method()} ${request.url()}${expected ? "" : "  <-- SURPRISE"}`,
        );
        if (!expected)
          this.surprises.push({ at: systemClock().getTime(), url: request.url(), page });
        return;
      }
      if (isRouterFetch(request)) {
        const h = request.headers();
        this.note(
          `rsc  ${short(request.url())} prefetch=${h["next-router-prefetch"] ?? "-"} seg=${h["next-router-segment-prefetch"] ?? "-"} next-url=${h["next-url"] ?? "-"} tree=${(h["next-router-state-tree"] ?? "-").slice(0, 240)}`,
        );
      } else if (request.resourceType() === "script") this.note(`script ${short(request.url())}`);
      else if (request.method() === "POST" && request.headers()["next-action"]) {
        this.note(`action ${short(request.url())}`);
      }
    });
    page.on("requestfinished", (request) => {
      if (
        !isRouterFetch(request) &&
        request.resourceType() !== "script" &&
        !(request.method() === "POST" && request.headers()["next-action"])
      )
        return;
      void request
        .response()
        .then((response) =>
          this.note(`  done ${response?.status() ?? "?"} ${short(request.url())}`),
        )
        .catch(() => undefined);
    });
    page.on("requestfailed", (request) => {
      if (isRouterFetch(request) || request.isNavigationRequest()) {
        this.note(`  FAILED ${request.failure()?.errorText ?? ""} ${short(request.url())}`);
      }
    });
    page.on("console", (message) => {
      const type = message.type();
      if (type === "error" || type === "warning" || /Falling back/.test(message.text())) {
        this.note(`console.${type} ${message.text().slice(0, 300)}`);
      }
    });
    page.on("pageerror", (error) => this.note(`pageerror ${error.message.slice(0, 300)}`));
  }

  /** DIAG: every event noted so far. */
  dump(): string[] {
    return this.events.map((event) => event.line);
  }

  /** Nothing to report, or one line per surprise load with the events that led up to it. */
  async report(): Promise<string[]> {
    const reports: string[] = [];
    for (const surprise of this.surprises) {
      const trace = await surprise.page
        .evaluate((key) => sessionStorage.getItem(key), TAP_TRACE_KEY)
        .catch(() => null);
      const recent = this.events
        .filter((event) => event.at >= surprise.at - RECENT_MS && event.at <= surprise.at + 50)
        .map((event) => `    ${event.line}`);
      reports.push(
        [
          `document load not asked for by the test: ${surprise.url}`,
          `  last link tap: ${trace ?? "none"}`,
          "  before it:",
          ...recent,
        ].join("\n"),
      );
    }
    return reports;
  }
}

function isRouterFetch(request: Request): boolean {
  return request.method() === "GET" && request.headers()["rsc"] === "1";
}

function short(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/([?&])_rsc=[^&]+/, "$1_rsc");
}
