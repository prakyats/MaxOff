import type { Locator, Page, TestInfo } from "@playwright/test";

/**
 * Diagnostics for the iPhone project only (v7.0 unit 3; the advisor, 25 Nov 2026). Neither this
 * container nor the advisor can open CI's traces (the artifact host is refused), so a WebKit-only
 * failure carries what it needs **in its error message**, which the job log prints. Nothing here
 * changes what a test checks: a step runs exactly as before, and only when it throws is the
 * record appended to the error.
 */
export const isIphone = (info: TestInfo) => info.project.name === "mobile-iphone";

type NavEvent = { at: number; kind: string; detail: string };

/**
 * Records, from the next document load on: `history.length`, every `pushState` / `replaceState`
 * call (the state's keys), every `popstate`, every RSC fetch (its address, when it left and when
 * it answered) and each change of `html[data-nav-pending]`. Install before the `goto`.
 */
export async function recordNavigation(page: Page, info: TestInfo): Promise<void> {
  if (!isIphone(info)) return;
  await page.addInitScript(() => {
    const started = performance.now();
    const events: NavEvent[] = [];
    const note = (kind: string, detail: string) => {
      events.push({ at: Math.round(performance.now() - started), kind, detail });
      if (events.length > 300) events.splice(0, events.length - 300);
    };
    (window as unknown as { __navEvents: NavEvent[] }).__navEvents = events;
    const keys = (state: unknown) =>
      state && typeof state === "object" ? Object.keys(state).join(",") : String(state);
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method].bind(history);
      history[method] = (state: unknown, unused: string, url?: string | URL | null) => {
        note(method, `${String(url ?? "")} {${keys(state)}} len=${history.length}`);
        return original(state, unused, url);
      };
    }
    window.addEventListener("popstate", (event) =>
      note(
        "popstate",
        `${location.pathname}${location.search} {${keys(event.state)}} len=${history.length}`,
      ),
    );
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const rsc = headers.get("rsc") === "1" || href.includes("_rsc=");
      if (!rsc) return fetchOriginal(input, init);
      const url = new URL(href, location.href);
      const tag = `${url.pathname}${headers.get("next-router-prefetch") ? " (prefetch)" : ""}`;
      note("rsc-out", tag);
      try {
        const response = await fetchOriginal(input, init);
        note("rsc-in", `${tag} ${response.status}`);
        return response;
      } catch (error) {
        note("rsc-fail", `${tag} ${String(error)}`);
        throw error;
      }
    };
    const watch = () =>
      new MutationObserver(() =>
        note(
          "nav-pending",
          `${document.documentElement.getAttribute("data-nav-pending") ?? "(none)"} slide=${document.documentElement.getAttribute("data-nav-slide") ?? "(none)"} at ${location.pathname}`,
        ),
      ).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-nav-pending", "data-nav-slide"],
      });
    if (document.documentElement) watch();
    else document.addEventListener("DOMContentLoaded", watch);
  });
}

async function navigationRecord(page: Page): Promise<string> {
  const events = await page
    .evaluate(() => {
      const list = (window as unknown as { __navEvents?: NavEvent[] }).__navEvents ?? [];
      return { list, length: history.length, url: location.href };
    })
    .catch(() => null);
  if (!events) return "(the page could not be read)";
  return [
    `url=${events.url} history.length=${events.length}`,
    ...events.list.map((event) => `+${event.at}ms ${event.kind} ${event.detail}`),
  ].join("\n");
}

/** What an element is doing: its box twice, 100 ms apart, its styles and its animations. */
async function elementRecord(target: Locator): Promise<string> {
  return target
    .evaluate(async (element) => {
      const box = () => {
        const rect = element.getBoundingClientRect();
        return `${rect.x.toFixed(1)},${rect.y.toFixed(1)} ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`;
      };
      const first = box();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = box();
      const lines = [`box ${first} → ${second}`];
      for (
        let node: Element | null = element;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        const animations = node
          .getAnimations()
          .map(
            (animation) =>
              `${animation.constructor.name}:${(animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? ""} ${animation.playState} t=${String(animation.currentTime)}`,
          );
        if (
          style.transform !== "none" ||
          style.animationName !== "none" ||
          style.transitionDuration !== "0s" ||
          animations.length > 0 ||
          node === element
        ) {
          const name = `${node.tagName.toLowerCase()}${node.getAttribute("data-slot") ? `[${node.getAttribute("data-slot")}]` : ""}`;
          lines.push(
            `${name}: transform=${style.transform} animation=${style.animationName} ${style.animationPlayState} transition=${style.transitionProperty} ${style.transitionDuration} visibility=${style.visibility} opacity=${style.opacity} pointer-events=${style.pointerEvents} inert=${String((node as HTMLElement).inert)} disabled=${String((node as HTMLButtonElement).disabled)} animations=[${animations.join("; ")}]`,
          );
        }
      }
      return lines.join("\n");
    })
    .catch((error: unknown) => `(the element could not be read: ${String(error)})`);
}

/**
 * Runs `step` and, on the iPhone project, appends the navigation record (and an element's, when
 * given) to its error. Elsewhere it is `step()` alone.
 */
export async function explainOnIphone<T>(
  page: Page,
  info: TestInfo,
  step: () => Promise<T>,
  element?: Locator,
): Promise<T> {
  if (!isIphone(info)) return step();
  try {
    return await step();
  } catch (error) {
    const parts = [`\n--- WebKit diagnostics (${info.title}) ---`, await navigationRecord(page)];
    if (element) parts.push("--- element ---", await elementRecord(element));
    if (error instanceof Error) {
      error.message = `${error.message}${parts.join("\n")}`;
      throw error;
    }
    throw new Error(`${String(error)}${parts.join("\n")}`);
  }
}
