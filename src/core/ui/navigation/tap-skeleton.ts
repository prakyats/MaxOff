import { ownHistoryWrite } from "./history-writes";

/**
 * A screen's skeleton on the tap, whatever the router has ready (#143; v7.0 generalised it from the
 * task page's `TaskTapSkeleton`). The router paints a page's `loading.tsx` at once only when it
 * already holds that boundary: right after a cold reopen the link's prefetch may not have gone yet
 * (the finger's own leaves after the click), and a live update's `router.refresh()` empties what
 * was prefetched. Then the old screen stays up until the server answers (~3 s on a cold Worker in
 * CI), or the router shows the `(app)` group's last-resort loading screen and slides it in, and the
 * screen's own skeleton waits for the slide to end (~0.4 s).
 *
 * So a plain tap on a link a registered screen claims (`TapSpec.match`) whose screen is not in the
 * route `TAP_SKELETON_AFTER_MS` later, while its navigation is under way (`html[data-nav-pending]`)
 * or has reached its address, draws that screen's skeleton (the spec's copy of the route's own
 * `loading.tsx` drawing) in `#main` and hides the route (`#main[data-tap-skeleton]`, globals.css).
 * It goes as soon as the route holds the screen (the router's skeleton, the page, or a finished
 * screen such as not found), when the address goes anywhere else, on back, or when the navigation
 * stands down on the old screen before the copy went up (a guard, a failed fetch), which then comes
 * back where it was. **History (§14.2):** the screen's address is the drill-down's one entry, put
 * there with Next's own state so the router's commit replaces it; back returns to the screen tapped
 * from; a tap on the bars while the router has drawn nothing undoes it first (`leave`). A tap that
 * opens a sheet or an unclaimed screen never matches, and a tap the router answers at once looks as
 * before (its slide).
 *
 * No React here and nothing a screen loads first: the specs register from the code each screen
 * loads after the page (`AfterPage`), so the shell's first-load JS is unchanged.
 */

/**
 * How long after a tap the router has to show the screen (its own loading screen or the page)
 * before the app draws the skeleton itself. Under it a tap the router answers from its prefetch
 * looks as before (the installed app's slide); over it, still well inside the 300 ms promise.
 */
export const TAP_SKELETON_AFTER_MS = 120;
/** The longest the drawn skeleton stays while the router has drawn nothing for the screen. */
const TAP_SKELETON_MAX_MS = 25_000;
/** A sheet's own history entry (`core/ui/overlay/overlay-history`): never copied onto ours. */
const OVERLAY_MARKER = "maxoffOverlay";

/**
 * `html[data-nav-pending]`: a navigation is under way (`NAV_PENDING_ATTRIBUTE`, `progress.ts`; a
 * unit test keeps the two equal). Named here because importing `progress.ts` into the part loaded
 * after the page moved it into every screen's first load (1.1 KB; the calendar's budget had 159
 * bytes left).
 */
export const NAV_PENDING = "data-nav-pending";

/** A link a spec claims: its path, its full address and the drawing it shows. */
export interface TapTarget {
  pathname: string;
  href: string;
  /** Which of the spec's drawings (a task's view, say). */
  variant: string;
}

/** A screen the engine can draw on the tap. */
export interface TapSpec {
  /** Unique per screen ("task"). */
  key: string;
  /** Whether a same-origin `href` opens this screen, and which drawing it shows. Pure. */
  match: (href: string, origin: string) => TapTarget | null;
  /**
   * Inside the route (`#main > [data-slot="route"]`): the router's loading screen or the page
   * itself, so the copy goes once either is in.
   */
  screen: string;
  /** The name the back control gives the screen tapped from (`BackLink` names where it lands). */
  backLabel: (from: string) => string;
  /** The copy of the drawing for a variant, or undefined before it was drawn. */
  drawing: (variant: string) => Element | undefined;
}

const specs = new Map<string, TapSpec>();

/** The spec claiming `href`, with its target, or null. */
function claim(href: string, origin: string): { spec: TapSpec; target: TapTarget } | null {
  for (const spec of specs.values()) {
    const target = spec.match(href, origin);
    if (target) return { spec, target };
  }
  return null;
}

/** The route's wrapper (`RouteTransition`): a new element once the router commits a new path. */
function currentRoute(): Element | null {
  return document.querySelector('#main > [data-slot="route"]');
}

/** The route's own screen for the tap is in: the router's loading screen or the page itself. */
function routeHasScreen(spec: TapSpec): boolean {
  return document.querySelector(`#main > [data-slot="route"] :is(${spec.screen})`) !== null;
}

/**
 * The tap being answered: which screen, where to, from where, whether the progress bar came for
 * it, and the route as it was at the tap (another one there means the router has committed).
 */
let tap:
  (TapTarget & { spec: TapSpec; from: string; pending: boolean; route: Element | null }) | null =
  null;
/** The screen's address is in the history (see `show`). */
let pushed = false;
let timer: number | undefined;
let cap: number | undefined;
/** The skeleton drawn into `#main`, and where the screen tapped from was scrolled. */
let drawn: { node: HTMLElement; origin: string; scrollY: number } | null = null;

function undraw(): void {
  if (drawn === null) return;
  const { node, origin, scrollY } = drawn;
  drawn = null;
  node.remove();
  document.getElementById("main")?.removeAttribute("data-tap-skeleton");
  // Back on the screen the tap was made on (back, a stand-down): where it was.
  if (window.location.pathname === origin) window.scrollTo(0, scrollY);
}

/** Watches the route and the progress bar while a tap is answered, and only then (`check`). */
let watch: MutationObserver | null = null;

function clear(): void {
  window.clearTimeout(timer);
  window.clearTimeout(cap);
  watch?.disconnect();
  watch = null;
  tap = null;
  pushed = false;
  undraw();
}

/** The router has committed a screen since the tap (its own entry then replaced ours). */
function committed(): boolean {
  return tap !== null && currentRoute() !== tap.route;
}

/**
 * Our entry is in the history and the router has drawn nothing for it yet: the screen under the
 * copy is still the one tapped from, as far as the router knows.
 */
function ours(): boolean {
  return pushed && tap !== null && !committed();
}

/** Nothing came at all: the copy goes, and our entry with it while the router has not used it. */
function giveUp(): void {
  const stillOurs = ours() && window.location.pathname === tap?.pathname;
  clear();
  if (stillOurs) window.history.back();
}

/** The timer's turn: the route still has no screen for the tap while the navigation is under way. */
function show(): void {
  const now = tap;
  const main = document.getElementById("main");
  const drawing = now === null ? undefined : now.spec.drawing(now.variant);
  if (now === null || main === null || drawing === undefined) return;
  // Offline, the router waits for the connection (Next retries the fetch then): the screen tapped
  // from stays, with the progress bar, as without this.
  if (!navigator.onLine) return;
  const at = window.location.pathname;
  const underWay = document.documentElement.hasAttribute(NAV_PENDING) || at === now.pathname;
  if (!underWay || (at !== now.from && at !== now.pathname) || routeHasScreen(now.spec)) return;
  // The skeleton is the screen, so the history says so (§14.2): back returns to the screen the tap
  // was made on, as it would from the screen, and Next restores it there (the late answer is
  // dropped). Next's own entry, with its state, minus a sheet's marker; when the router commits
  // the screen at the same address it replaces this entry rather than adding another
  // (`HistoryUpdater`), so the history is as if the router had been at once.
  if (at === now.from) {
    const state = { ...((window.history.state ?? {}) as Record<string, unknown>) };
    delete state[OVERLAY_MARKER];
    // Next's state (`__NA`) on it: Next's patched `pushState` passes it straight through, with no
    // router "restore" (the hand-written address `view-address.ts` guards against is a state-less
    // replace, which Next turns into one).
    ownHistoryWrite(() =>
      // eslint-disable-next-line no-restricted-syntax -- a drill-down's own entry, Next's state on it, not a view's address
      window.history.pushState(state, "", now.href),
    );
    pushed = true;
  }
  // A copy of the drawing, outside React: the router's commits (its last-resort `(app)` loading
  // screen first, on the way to this one) unmount the screen tapped from, and this stays. Its
  // links and buttons do nothing (`inert`): the real ones come with the screen itself.
  const node = document.createElement("div");
  node.setAttribute("data-slot", "tap-skeleton");
  node.setAttribute("data-tap-screen", now.spec.key);
  const copy = drawing.cloneNode(true) as Element;
  for (const control of copy.querySelectorAll("a, button, [tabindex]")) {
    control.setAttribute("inert", "");
  }
  // The back control names the screen it lands on (`BackLink`): the one tapped from, which a
  // drawing made elsewhere cannot know.
  const label = now.spec.backLabel(now.from);
  for (const back of copy.querySelectorAll('[data-slot="page-back"]')) {
    if (back.hasAttribute("aria-label")) back.setAttribute("aria-label", `Back to ${label}`);
    for (const text of back.childNodes) {
      if (text.nodeType === Node.TEXT_NODE && text.textContent?.trim()) text.textContent = label;
    }
  }
  node.append(copy);
  drawn = { node, origin: now.from, scrollY: window.scrollY };
  main.append(node);
  main.setAttribute("data-tap-skeleton", "");
  window.scrollTo(0, 0);
  cap = window.setTimeout(giveUp, TAP_SKELETON_MAX_MS);
}

/** What a tap can act on outside the copy (the shell's bars stay live while it is up). */
const CONTROL = "a[href], button, summary, [role='button'], [role='link'], [role='tab']";

/**
 * A tap elsewhere while our entry waits for the router (a bar tab, the bell): the screen is
 * abandoned first, back to the screen tapped from, and the same tap is then made there, so it
 * moves from that screen's entry as it would have without the copy (a bar tab going home goes back
 * to home, not to this screen).
 */
function leave(control: Element): void {
  const replay = () => {
    window.removeEventListener("popstate", replay);
    window.setTimeout(() => {
      if (control.isConnected) {
        control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    }, 0);
  };
  window.addEventListener("popstate", replay);
  window.history.back();
}

function onClick(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
  if (control !== null && drawn !== null && ours() && !drawn.node.contains(control)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    leave(control);
    return;
  }
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
  if (link.target && link.target !== "_self") return;
  const claimed = claim(link.getAttribute("href") ?? "", window.location.origin);
  if (!claimed || claimed.target.pathname === window.location.pathname) return;
  clear();
  tap = {
    ...claimed.target,
    spec: claimed.spec,
    from: window.location.pathname,
    pending: document.documentElement.hasAttribute(NAV_PENDING),
    route: currentRoute(),
  };
  watch = new MutationObserver(check);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: [NAV_PENDING] });
  const main = document.getElementById("main");
  if (main !== null) watch.observe(main, { childList: true, subtree: true });
  timer = window.setTimeout(show, TAP_SKELETON_AFTER_MS);
}

/**
 * The route's screen came in (its own, or any finished screen the router drew at its address: not
 * found, an error), the address went elsewhere, or the navigation stood down on the old screen (no
 * fetch went, a guard kept it): ours goes. A loading screen the router commits on the way (the
 * `(app)` group's last resort, `aria-busy`) keeps it.
 */
function check(): void {
  if (tap === null) return;
  const at = window.location.pathname;
  const pending = document.documentElement.hasAttribute(NAV_PENDING);
  if (pending) tap.pending = true;
  const route = currentRoute();
  const drewScreen =
    committed() &&
    at === tap.pathname &&
    route !== null &&
    route.firstElementChild !== null &&
    route.querySelector('[aria-busy="true"]') === null;
  if (routeHasScreen(tap.spec) || drewScreen || (at !== tap.from && at !== tap.pathname)) clear();
  // Before the skeleton went up only: once the screen's address is in the history the progress
  // bar finishes (the address moved; a loading screen is not one it waits on, as when the router
  // draws it), and the navigation is still on its way. A stand-down is the bar going **after it
  // came**: before it comes, the screen tapped from may still be drawing itself (a row tapped the
  // moment it is there, #143), which is not one.
  else if (!pushed && tap.pending && at === tap.from && !pending) clear();
}

let listening = false;

/**
 * Once per page load: a tap's listener outlives every screen, as the skeleton it draws does. The
 * rest listens only while a tap is answered (`watch`), or does nothing without one: back, and the
 * connection going (the screen tapped from comes back, with the progress bar waiting for the
 * connection, as without the copy).
 */
function listen(): void {
  // No document (the unit tests): the specs register, nothing listens.
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("click", onClick, { capture: true });
  window.addEventListener("popstate", clear);
  window.addEventListener("offline", () => {
    if (drawn !== null) giveUp();
  });
}

/**
 * A screen joins the engine (once per page load; a second registration of the same key replaces
 * the first). The engine starts listening with the first.
 */
export function registerTapSpec(spec: TapSpec): void {
  specs.set(spec.key, spec);
  listen();
}

/** For the unit tests: which spec claims `href`. */
export function claimedBy(href: string, origin: string): string | null {
  return claim(href, origin)?.spec.key ?? null;
}
