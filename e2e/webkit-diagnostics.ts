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
/**
 * The network's own times for each RSC request (Playwright's `request.timing()`, from the
 * browser's network stack, not the page): when it was sent and when the response's first and last
 * bytes came. Beside the page's own record it says whether a body was slow from the server or slow
 * to be read in the page (CI 45721772197: four prefetch bodies the page read 5.7 s late).
 */
const networkTimes = new WeakMap<Page, string[]>();

export async function recordNavigation(page: Page, info: TestInfo): Promise<void> {
  if (!isIphone(info)) return;
  const lines: string[] = [];
  networkTimes.set(page, lines);
  page.on("requestfinished", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    if (headers["rsc"] !== "1" && !url.search.includes("_rsc=")) return;
    const timing = request.timing();
    const prefetch = headers["next-router-prefetch"] ? " (prefetch)" : "";
    lines.push(
      `${url.pathname}${prefetch} sent@${Math.round(timing.startTime)} firstByte+${Math.round(timing.responseStart)} lastByte+${Math.round(timing.responseEnd)} (epoch ms; + is ms after sent)`,
    );
  });
  await page.addInitScript(() => {
    const started = performance.now();
    const events: NavEvent[] = [];
    const note = (kind: string, detail: string) => {
      events.push({ at: Math.round(performance.now() - started), kind, detail });
      if (events.length > 600) events.splice(0, events.length - 600);
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
      // Who sent it (CI 45721772197: were the prefetches the commit waited on Next's own Link or
      // our likely-prefetch scheduler?): the calling frames' chunk files and positions.
      const from = (new Error().stack ?? "")
        .split("\n")
        .slice(2, 8)
        .map((frame) => {
          const match = /([^/\s(]+\.js)[^:]*:(\d+):(\d+)/.exec(frame);
          const name = /^\s*(?:at )?([^\s@(]+)[\s@(]/.exec(frame)?.[1] ?? "";
          return match ? `${name}@${match[1]}:${match[2]}:${match[3]}` : frame.trim().slice(0, 40);
        })
        .join(" < ");
      note("rsc-out", `${tag} from=${from}`);
      try {
        const response = await fetchOriginal(input, init);
        note("rsc-in", `${tag} ${response.status}`);
        // When the body's first bytes and its end arrive: a commit waits for the payload, not for
        // the headers (v7.0, the create dialog's 4.5 s between rsc-in and the push).
        const reader = response.clone().body?.getReader();
        if (reader) {
          void (async () => {
            let bytes = 0;
            for (;;) {
              const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
              if (chunk.done) break;
              if (bytes === 0) note("rsc-first-chunk", tag);
              bytes += chunk.value?.byteLength ?? 0;
            }
            note("rsc-done", `${tag} ${bytes} bytes`);
          })();
        }
        return response;
      } catch (error) {
        note("rsc-fail", `${tag} ${String(error)}`);
        throw error;
      }
    };
    // v7.0 tasks:1043 (the advisor, 26 Nov): the commit came 6.6 s after the last RSC byte, so
    // what else can hold it? Each candidate below is recorded, none changes behaviour.
    const nativeTimeout = window.setTimeout.bind(window);
    const callers = (skip = 2) =>
      (new Error().stack ?? "")
        .split("\n")
        .slice(skip, skip + 4)
        .map((frame) => {
          const match = /([^/\s(]+\.js)[^:]*:(\d+):(\d+)/.exec(frame);
          const name = /^\s*(?:at )?([^\s@(]+)[\s@(]/.exec(frame)?.[1] ?? "";
          return match ? `${name}@${match[1]}:${match[2]}:${match[3]}` : frame.trim().slice(0, 40);
        })
        .join(" < ");
    // (1)-(3) Every non-RSC resource the page loads (scripts, CSS, fonts, images), with the
    // browser's own times, relative to the same zero as every other line.
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.name.includes("_rsc=")) continue;
          if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") continue;
          const path = new URL(entry.name, location.href).pathname;
          note(
            "resource",
            `${entry.initiatorType} ${path} start+${Math.round(entry.startTime - started)} end+${Math.round(entry.responseEnd - started)} bytes=${entry.transferSize}`,
          );
        }
      }).observe({ type: "resource", buffered: false });
    } catch {
      note("resource", "(no PerformanceObserver for resources)");
    }
    // (3) Fonts.
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts) {
      fonts.addEventListener("loading", () => note("fonts", `loading status=${fonts.status}`));
      fonts.addEventListener("loadingdone", () =>
        note("fonts", `loadingdone status=${fonts.status}`),
      );
      fonts.addEventListener("loadingerror", () =>
        note("fonts", `loadingerror status=${fonts.status}`),
      );
    }
    // (3) View transitions: when one is asked for, when its update ran, and when it was ready
    // and finished.
    const doc = document;
    if (typeof doc.startViewTransition === "function") {
      const start = doc.startViewTransition.bind(doc);
      doc.startViewTransition = (update?: Parameters<typeof start>[0]) => {
        // CI 45752942623: 6.1 s blocked between this start and its update. What the browser has
        // to photograph: the route's box, how many elements it holds, what is animating, and the
        // clip the slide sets (slide.ts `clipLeavingRoute`).
        const route = document.querySelector<HTMLElement>('#main > [data-slot="route"]');
        const box = route?.getBoundingClientRect();
        const running = document.getAnimations().map((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          const name =
            (animation as CSSAnimation).animationName ??
            (animation as CSSTransition).transitionProperty ??
            "?";
          return `${name}@${target instanceof Element ? target.tagName.toLowerCase() : "?"}`;
        });
        note(
          "view-transition",
          `start route=${box ? `${Math.round(box.width)}x${Math.round(box.height)} top=${Math.round(box.top)}` : "none"} elements=${route?.querySelectorAll("*").length ?? 0} clip=${route?.style.clipPath || "none"} scrollY=${Math.round(window.scrollY)} animations=${running.length}[${running.slice(0, 12).join(",")}] from=${callers()}`,
        );
        const transition = start(update);
        void transition.updateCallbackDone.then(
          () => note("view-transition", "update done"),
          (error: unknown) => note("view-transition", `update failed ${String(error)}`),
        );
        void transition.ready.then(
          () => note("view-transition", "ready"),
          (error: unknown) => note("view-transition", `ready failed ${String(error)}`),
        );
        void transition.finished.then(
          () => note("view-transition", "finished"),
          () => note("view-transition", "finished (rejected)"),
        );
        return transition;
      };
    } else {
      note("view-transition", "(no document.startViewTransition)");
    }
    // (5) Timers: every setTimeout still pending, with its delay and who set it; and the main
    // thread's own gaps (a 100 ms heartbeat that came late by more than 250 ms).
    const pending = new Map<number, { at: number; delay: number; from: string }>();
    const timeoutOriginal = window.setTimeout.bind(window);
    const clearOriginal = window.clearTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
      const from = callers(3);
      const at = Math.round(performance.now() - started);
      const id: number = timeoutOriginal(
        (...args: unknown[]) => {
          pending.delete(id);
          if (typeof handler === "function") (handler as (...a: unknown[]) => void)(...args);
        },
        delay,
        ...rest,
      );
      pending.set(id, { at, delay: Number(delay ?? 0), from });
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined) pending.delete(id);
      clearOriginal(id);
    }) as typeof window.clearTimeout;
    const pendingTimers = () =>
      [...pending.values()]
        .map((timer) => `set+${timer.at} delay=${timer.delay} from=${timer.from}`)
        .join(" | ") || "(none)";
    (window as unknown as { __pendingTimers: () => string }).__pendingTimers = pendingTimers;
    let beat = performance.now();
    const heartbeat = () => {
      const now = performance.now();
      if (now - beat > 350) note("main-thread", `heartbeat ${Math.round(now - beat)} ms apart`);
      beat = now;
      nativeTimeout(heartbeat, 100);
    };
    nativeTimeout(heartbeat, 100);
    // While a move is pending, once a second: which timers are waiting.
    const tick = () => {
      if (document.documentElement?.hasAttribute("data-nav-pending"))
        note("timers", `pending: ${pendingTimers()}`);
      nativeTimeout(tick, 1000);
    };
    nativeTimeout(tick, 1000);
    // (6) The create dialog's close: its animations and transitions starting and ending.
    const where = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return "?";
      const slot = target.closest("[data-slot]")?.getAttribute("data-slot") ?? "";
      const role = target.closest("[role]")?.getAttribute("role") ?? "";
      return `${target.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}${role ? ` in ${role}` : ""}`;
    };
    for (const kind of ["animationstart", "animationend", "animationcancel"] as const)
      window.addEventListener(
        kind,
        (event) =>
          note(kind, `${(event as AnimationEvent).animationName} on ${where(event.target)}`),
        true,
      );
    for (const kind of ["transitionstart", "transitionend", "transitioncancel"] as const)
      window.addEventListener(
        kind,
        (event) =>
          note(kind, `${(event as TransitionEvent).propertyName} on ${where(event.target)}`),
        true,
      );
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
    // Our likely-prefetch scheduler asks through `router.prefetch()`; a <Link>'s own prefetch
    // goes straight to Next's internal scheduler. Each call is noted, so an rsc-out prefetch
    // with no call just before it was a <Link>'s.
    const wrapRouter = window.setInterval(() => {
      const router = (window as unknown as { next?: { router?: Record<string, unknown> } }).next
        ?.router;
      if (!router || typeof router.prefetch !== "function") return;
      window.clearInterval(wrapRouter);
      const prefetch = (router.prefetch as (href: string, options?: unknown) => unknown).bind(
        router,
      );
      router.prefetch = (href: string, options?: unknown) => {
        note("router.prefetch", String(href));
        return prefetch(href, options);
      };
    }, 50);
  });
}

async function navigationRecord(page: Page): Promise<string> {
  const events = await page
    .evaluate(() => {
      const list = (window as unknown as { __navEvents?: NavEvent[] }).__navEvents ?? [];
      const timers = (window as unknown as { __pendingTimers?: () => string }).__pendingTimers;
      return {
        list,
        length: history.length,
        url: location.href,
        fonts: document.fonts?.status ?? "(none)",
        timers: timers ? timers() : "(not recorded)",
      };
    })
    .catch(() => null);
  if (!events) return "(the page could not be read)";
  const network = networkTimes.get(page) ?? [];
  return [
    `url=${events.url} history.length=${events.length} fonts=${events.fonts}`,
    `pending timers now: ${events.timers}`,
    ...events.list.map((event) => `+${event.at}ms ${event.kind} ${event.detail}`),
    ...(network.length > 0
      ? ["--- network (RSC, browser's own times) ---", ...network.slice(-40)]
      : []),
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
  extra?: () => string,
): Promise<T> {
  if (!isIphone(info)) return step();
  try {
    return await step();
  } catch (error) {
    const parts = [`\n--- WebKit diagnostics (${info.title}) ---`, await navigationRecord(page)];
    if (element) parts.push("--- element ---", await elementRecord(element));
    if (extra) parts.push("--- requests ---", extra());
    if (error instanceof Error) {
      error.message = `${error.message}${parts.join("\n")}`;
      throw error;
    }
    throw new Error(`${String(error)}${parts.join("\n")}`);
  }
}

/**
 * Every request the page sends whose path starts with `prefix`, from now on: when the page sent
 * it, whether `page.route` handed it to a handler (`routed`, which the caller marks) and how it
 * ended. For a request a route did not see (the bell's count on WebKit, CI 45678861249).
 */
export function recordRequests(
  page: Page,
  info: TestInfo,
  prefix: string,
): { routed: (url: string) => void; report: () => string } {
  const started = Math.round(performance.now());
  const lines: string[] = [];
  if (isIphone(info)) {
    const pathOf = (url: string) => {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    };
    page.on("request", (request) => {
      const path = pathOf(request.url());
      if (!path.startsWith(prefix)) return;
      lines.push(
        `+${Math.round(performance.now()) - started}ms request ${request.method()} ${path} frame=${request.frame().url() === page.url() ? "page" : request.frame().url()} sw=${String(request.serviceWorker() !== null)}`,
      );
    });
    page.on("requestfinished", (request) => {
      const path = pathOf(request.url());
      if (path.startsWith(prefix))
        lines.push(`+${Math.round(performance.now()) - started}ms finished ${path}`);
    });
    page.on("requestfailed", (request) => {
      const path = pathOf(request.url());
      if (path.startsWith(prefix))
        lines.push(
          `+${Math.round(performance.now()) - started}ms failed ${path} ${request.failure()?.errorText ?? ""}`,
        );
    });
  }
  return {
    routed: (url) => {
      if (!isIphone(info)) return;
      lines.push(`+${Math.round(performance.now()) - started}ms routed ${new URL(url).pathname}`);
    },
    report: () => lines.join("\n") || "(none)",
  };
}
