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

/** Runs before the app's scripts: the last link tap, where a document load cannot erase it. */
function traceTaps() {
  const key = "__e2eLastTap";
  window.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            // Monotonic, for ordering against the watcher's log only.
            at: Math.round(performance.now()),
            href: anchor.getAttribute("href"),
            slot: anchor.getAttribute("data-slot"),
            live: anchor.hasAttribute("data-live"),
            hydrated: document.documentElement.hasAttribute("data-chrome"),
            text: (anchor.textContent ?? "").trim().slice(0, 40),
          }),
        );
      } catch {
        // Storage blocked: the trace is only a diagnostic.
      }
    },
    true,
  );
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
      if (isRouterFetch(request)) this.note(`rsc  ${short(request.url())}`);
      else if (request.method() === "POST" && request.headers()["next-action"]) {
        this.note(`action ${short(request.url())}`);
      }
    });
    page.on("requestfinished", (request) => {
      if (
        !isRouterFetch(request) &&
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
