"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ownHistoryWrite } from "@/core/ui/navigation/history-writes";

import { NAV_PENDING, type TaskTap, taskBackLabel, taskTapTarget } from "../domain/tap";
import { TASK_VIEWS, type TaskView } from "../domain/views";
import { TaskPageSkeleton } from "./task-page-skeleton";

/**
 * How long after a tap the router has to show the task page (its own loading screen or the page)
 * before the app draws the skeleton itself. Under it a tap the router answers from its prefetch
 * looks as before (the installed app's slide); over it, still well inside the 300 ms promise.
 */
export const TASK_TAP_SKELETON_AFTER_MS = 120;
/** The longest the drawn skeleton stays while the router has drawn nothing for the task. */
const TASK_TAP_SKELETON_MAX_MS = 25_000;
/** A sheet's own history entry (`core/ui/overlay/overlay-history`): never copied onto ours. */
const OVERLAY_MARKER = "maxoffOverlay";

/** The route's wrapper (`RouteTransition`): a new element once the router commits a new path. */
function currentRoute(): Element | null {
  return document.querySelector('#main > [data-slot="route"]');
}

/** The route's own task screen is in: the router's loading screen or the page itself. */
function routeHasTaskScreen(): boolean {
  return (
    document.querySelector(
      '#main > [data-slot="route"] :is([data-slot="loading-task"], [data-slot="task-page"])',
    ) !== null
  );
}

/** The skeleton of each view as `TaskPageSkeleton` drew it (see `TaskTapSkeleton`). */
const drawings = new Map<TaskView, Element>();
/** For whom `drawings` were made (`manages`), or null before the first drawing. */
let drawnFor: boolean | null = null;

/**
 * The tap being answered: where to, from where, whether the progress bar came for it, and the
 * route as it was at the tap (another one there means the router has committed something).
 */
let tap: (TaskTap & { from: string; pending: boolean; route: Element | null }) | null = null;
/** The task's address is in the history (see `show`). */
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

/** The timer's turn: the route still has no task screen while the navigation is under way. */
function show(): void {
  const now = tap;
  const main = document.getElementById("main");
  const drawing = now === null ? undefined : drawings.get(now.view);
  if (now === null || main === null || drawing === undefined) return;
  // Offline, the router waits for the connection (Next retries the fetch then): the screen tapped
  // from stays, with the progress bar, as without this.
  if (!navigator.onLine) return;
  const at = window.location.pathname;
  const underWay = document.documentElement.hasAttribute(NAV_PENDING) || at === now.pathname;
  if (!underWay || (at !== now.from && at !== now.pathname) || routeHasTaskScreen()) return;
  // The skeleton is the task's screen, so the history says so (§14.2): back returns to the screen
  // the tap was made on, as it would from the task, and Next restores it there (the late answer is
  // dropped). Next's own entry, with its state, minus a sheet's marker; when the router commits
  // the task at the same address it replaces this entry rather than adding another
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
  // links and buttons do nothing (`inert`): the real ones come with the task's own screen.
  const node = document.createElement("div");
  node.setAttribute("data-slot", "tap-skeleton");
  const copy = drawing.cloneNode(true) as Element;
  for (const control of copy.querySelectorAll("a, button, [tabindex]")) {
    control.setAttribute("inert", "");
  }
  // The back control names the screen it lands on (`BackLink`): the one tapped from, which a
  // drawing made away from the task page cannot know.
  const label = taskBackLabel(now.from);
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
  cap = window.setTimeout(giveUp, TASK_TAP_SKELETON_MAX_MS);
}

/** What a tap can act on outside the copy (the shell's bars stay live while it is up). */
const CONTROL = "a[href], button, summary, [role='button'], [role='link'], [role='tab']";

/**
 * A tap elsewhere while our entry waits for the router (a bar tab, the bell): the task is
 * abandoned first, back to the screen tapped from, and the same tap is then made there, so it
 * moves from that screen's entry as it would have without the task (a bar tab going home goes
 * back to home, not to this screen).
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
  const target = taskTapTarget(link.getAttribute("href") ?? "", window.location.origin);
  if (!target || target.pathname === window.location.pathname) return;
  clear();
  tap = {
    ...target,
    from: window.location.pathname,
    pending: document.documentElement.hasAttribute(NAV_PENDING),
    route: currentRoute(),
  };
  watch = new MutationObserver(check);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: [NAV_PENDING] });
  const main = document.getElementById("main");
  if (main !== null) watch.observe(main, { childList: true, subtree: true });
  timer = window.setTimeout(show, TASK_TAP_SKELETON_AFTER_MS);
}

/**
 * The route's screen came in (the task's own, or any finished screen the router drew at the
 * task's address: not found, an error), the address went elsewhere, or the navigation stood down
 * on the old screen (no fetch went, a guard kept it): ours goes. A loading screen the router
 * commits on the way (the `(app)` group's last resort, `aria-busy`) keeps it.
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
  if (routeHasTaskScreen() || drewScreen || (at !== tap.from && at !== tap.pathname)) clear();
  // Before the skeleton went up only: once the task's address is in the history the progress bar
  // finishes (the address moved; a task's loading screen is not one it waits on, as when the
  // router draws it), and the navigation is still on its way. A stand-down is
  // the bar going **after it came**: before it comes, the screen tapped from may still be drawing
  // itself (a row tapped the moment it is there, #143), which is not one.
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
  if (listening) return;
  listening = true;
  document.addEventListener("click", onClick, { capture: true });
  window.addEventListener("popstate", clear);
  window.addEventListener("offline", () => {
    if (drawn !== null) giveUp();
  });
}

/**
 * A task's skeleton on the tap, whatever the router has ready (#143; CI 43220640676, the
 * advisor's trace). The router paints a page's `loading.tsx` at once only when it already holds
 * that boundary: right after a cold reopen the row's prefetch may not have gone yet (the finger's
 * own leaves after the click), and a live update's `router.refresh()` empties what was
 * prefetched. Then the old screen stays up until the server answers (~3 s on a cold Worker in
 * CI), or the router shows the `(app)` group's last-resort loading screen and slides it in, and
 * the task's own skeleton waits for the slide to end (~0.4 s here).
 *
 * So a plain tap on a link to a task's page (`taskTapTarget`) whose screen is not in the route
 * `TASK_TAP_SKELETON_AFTER_MS` later, while its navigation is under way (`html[data-nav-pending]`)
 * or has reached the task's address, draws the task's skeleton in `#main` and hides the route
 * (`#main[data-tap-skeleton]`, globals.css). It goes as soon as the route holds the task's screen
 * (the router's skeleton, the page, or a finished screen such as not found), when the address goes
 * anywhere else, on back, or when the navigation stands down on the old screen before the copy
 * went up (a guard, a failed fetch), which then comes back where it was. **History (§14.2):** the
 * task's address is the drill-down's one entry, put there with Next's own state so the router's
 * commit replaces it; back returns to the screen tapped from; a tap on the bars while the router
 * has drawn nothing undoes the task first (`leave`). A tap that opens a sheet or another screen
 * never matches, and a tap the router answers at once looks as before (its slide).
 *
 * **The drawing is the route's own:** this component renders `TaskPageSkeleton` (what the
 * route's `loading.tsx` renders) for each view into a node outside the document, so it is never
 * on screen and no query finds it, and keeps a copy of each; a tap draws that copy. A copy rather
 * than this component's own render because the router's first commit can unmount the screen
 * tapped from (see `show`). Mounted on the screens whose rows open tasks (Tasks, All tasks,
 * Suggested tasks, Today, My Day, Approvals; an alert opens through `/open`, which this does not
 * cover), never in the shared layout: the calendar's
 * first-load budget had no room. Once one of them has loaded it, a task tapped on any screen is
 * covered until the app is closed.
 */
export function TaskTapSkeleton({ manages }: { manages: boolean }) {
  const [offscreen] = useState(() => document.createElement("div"));
  // Drawn once per page load and viewer: a screen mounted later (back to Tasks, the next tab)
  // renders nothing, so the work never lands on a navigation's commit (CI 43376075667, the Crew's
  // next tap 388 ms after back).
  const draws = drawnFor !== manages;
  useEffect(listen, []);
  useEffect(() => {
    if (!draws) return;
    for (const view of offscreen.querySelectorAll<HTMLElement>("[data-tap-view]")) {
      const drawing = view.firstElementChild;
      if (drawing)
        drawings.set(view.dataset.tapView as TaskView, drawing.cloneNode(true) as Element);
    }
    drawnFor = manages;
  }, [draws, manages, offscreen]);
  if (!draws) return null;
  return createPortal(
    TASK_VIEWS.map((view) => (
      <div key={view} data-tap-view={view}>
        <TaskPageSkeleton manages={manages} view={view} />
      </div>
    )),
    offscreen,
  );
}
