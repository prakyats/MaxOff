import {
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./attributes";
import { ownHistoryWrite } from "./history-writes";
import { originMatches, tabMove } from "./moves";

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
 * **A bar tab (v7.0, `history: "tab"`)** writes only the entry the bar's own move will make
 * (`tabMove`, `tab-history.ts`): installed, home → a tab pushes (the tab's address, as a
 * drill-down's), a tab → another tab replaces (nothing written: back during the copy goes home, as
 * it would from the tab), a tab → home is a back (never drawn: its popstate clears the tap first,
 * and the router answers it from its memory). In a browser tab the bar is plain links: a push. A
 * view control (`ViewLink`: a person's or a client's own tabs) is never taken: its screen's header
 * is already up, and it never adds history.
 *
 * No React here and nothing a screen loads first: the specs register from the code loaded after
 * the page (the `(app)` layout's one `AfterPage` loader), so the shell's first-load JS is
 * unchanged. **Drawings carry no member data** (ARCHITECTURE §14.2 m): no name, no date, no
 * record; where a screen's loading screen shows one, its drawing shows a bar of the same size.
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
  /**
   * How the tap moves through history: a drill-down's one entry (the default), or a bar tab's
   * move (`tabHistoryWrite`) when the link is one of the bar's tabs.
   */
  history?: "drill" | "tab";
  /** Draws the variant now if it is not drawn yet (the finger going down on its link). */
  prepare?: (variant: string) => void;
}

/**
 * What a tap writes in the history when the copy goes up, from the bar's own move (`tabMove`):
 * its address pushed (a drill-down, a link, home → a tab) or nothing (a tab replacing a tab, home
 * replacing a tab). A tab → home with home beneath is a back: nothing is written either, and the
 * back's popstate clears the tap before the copy's moment, so it never shows there (the router
 * answers a back from its memory). Whether home is beneath is the bar's to know (`tab-history`'s
 * own state, which a reload resets): either way the copy writes nothing.
 */
export function tabHistoryWrite(move: ReturnType<typeof tabMove>): "push" | "none" {
  return move === null || move === "push" ? "push" : "none";
}

/**
 * The name the back control of a drawing made away from its screen gives the screen tapped
 * from: the origin it is when it is one (`BackLink`'s `from`), else the parent's own label.
 */
export function backLabelFrom(
  parent: string,
  origins: readonly { path: string; label: string }[],
): (from: string) => string {
  return (from) => origins.find((origin) => originMatches(origin.path, from))?.label ?? parent;
}

/**
 * A link's address when it is exactly one of `pattern`'s paths (same origin, no query or only
 * `allowed` keys), else null. Pure.
 */
export function pathTarget(
  href: string,
  origin: string,
  pattern: RegExp,
  allowed: readonly string[] = [],
): { pathname: string; href: string; search: URLSearchParams } | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !pattern.test(url.pathname)) return null;
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key))) return null;
  return {
    pathname: url.pathname,
    href: `${url.pathname}${url.search}${url.hash}`,
    search: url.searchParams,
  };
}

/** Running installed (the bar's moves are then the app's own, `tab-history.ts`). */
function standalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** The history write for a tap on `link` to `pathname` from `from` (`tabHistoryWrite`). */
function historyWrite(
  spec: TapSpec,
  link: Element,
  pathname: string,
  from: string,
): "push" | "none" {
  if (spec.history !== "tab" || !link.hasAttribute(TAB_ATTRIBUTE)) return "push";
  const bar = link.closest(`[${TAB_HOME_ATTRIBUTE}]`);
  if (bar === null) return "push";
  return tabHistoryWrite(
    tabMove({
      href: pathname,
      pathname: from,
      home: bar.getAttribute(TAB_HOME_ATTRIBUTE) ?? "",
      topLevel: (bar.getAttribute(TAB_TOP_ATTRIBUTE) ?? "").split(" "),
      standalone: standalone(),
      pushedFromHome: false,
    }),
  );
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
  | (TapTarget & {
      spec: TapSpec;
      from: string;
      pending: boolean;
      route: Element | null;
      /** The copy puts the screen's address in the history (a drill-down, home → a tab). */
      push: boolean;
    })
  | null = null;
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

/**
 * The cap's turn: while the move is still under way the copy stays, and the move is the status
 * line's (§14.2 i: "Still loading" at 8 s, Retry at 25 s, the same moment as this cap): giving up
 * then went back and dropped the move Retry was offered for (CI 45721772197). Once the router has
 * stood down with nothing for the screen, the copy goes.
 */
function capReached(): void {
  if (document.documentElement.hasAttribute(NAV_PENDING)) {
    cap = window.setTimeout(capReached, TAP_SKELETON_MAX_MS);
    return;
  }
  giveUp();
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
  if (at === now.from && now.push) {
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
  cap = window.setTimeout(capReached, TAP_SKELETON_MAX_MS);
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

/**
 * The link a tap is on when a registered screen claims it and it leaves this screen: a plain
 * same-window link, not a download and not a view control (`ViewLink` replaces within its screen).
 */
function claimedLink(
  target: EventTarget | null,
): { link: HTMLAnchorElement; claimed: { spec: TapSpec; target: TapTarget } } | null {
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return null;
  if (link.target && link.target !== "_self") return null;
  if (link.hasAttribute(VIEW_LINK_ATTRIBUTE)) return null;
  const claimed = claim(link.getAttribute("href") ?? "", window.location.origin);
  if (!claimed || claimed.target.pathname === window.location.pathname) return null;
  return { link, claimed };
}

/**
 * The finger going down on a claimed link whose drawing is not made yet (the idle pre-render has
 * not reached it): it is drawn now, before the click (v7.0).
 */
function onPress(event: Event): void {
  const found = claimedLink(event.target);
  if (found === null) return;
  const { spec, target } = found.claimed;
  if (spec.drawing(target.variant) === undefined) spec.prepare?.(target.variant);
}

function onClick(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
  // The status line's Retry is the pending move's own (§14.2 i), not a tap elsewhere: leaving
  // the copy first went back and took the line, and the Retry with it (CI 45721772197).
  const ownStatus = control?.closest('[data-slot="nav-progress-status"]') != null;
  if (control !== null && !ownStatus && drawn !== null && ours() && !drawn.node.contains(control)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    leave(control);
    return;
  }
  const found = claimedLink(event.target);
  if (found === null) return;
  const { link, claimed } = found;
  const from = window.location.pathname;
  const write = historyWrite(claimed.spec, link, claimed.target.pathname, from);
  clear();
  tap = {
    ...claimed.target,
    spec: claimed.spec,
    from,
    pending: document.documentElement.hasAttribute(NAV_PENDING),
    route: currentRoute(),
    push: write === "push",
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
  document.addEventListener("pointerdown", onPress, { capture: true, passive: true });
  document.addEventListener("touchstart", onPress, { capture: true, passive: true });
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

/** The spec and target claiming `href` (the drawings' pre-render orders by what is on screen). */
export function claimTap(href: string, origin: string): { key: string; variant: string } | null {
  const claimed = claim(href, origin);
  return claimed ? { key: claimed.spec.key, variant: claimed.target.variant } : null;
}

/** A drawing's place in the pre-render: a bar tab of the viewer's, or a drill-down. */
export type DrawingGroup = "tab" | "drill";

/**
 * The order the drawings are made in, one per idle slice (v7.0): those for the links on screen
 * first (in the order they are on it), then the viewer's other tabs, then the drill-downs. Ids
 * not among `all` are dropped, and none is listed twice. Pure.
 */
export function drawingOrder(
  all: readonly { id: string; group: DrawingGroup }[],
  onScreen: readonly string[],
): string[] {
  const known = new Set(all.map((drawing) => drawing.id));
  const order = new Set(onScreen.filter((id) => known.has(id)));
  for (const group of ["tab", "drill"] as const) {
    for (const drawing of all) if (drawing.group === group) order.add(drawing.id);
  }
  return [...order];
}
