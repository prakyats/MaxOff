/*
 * MaxOff service worker (task 0.5, ARCHITECTURE §14): a minimal offline shell.
 *
 * - Precaches the /offline page and serves it when a navigation fails without a connection.
 *   A failed navigation is tried once more after 1.5 s first, so a phone switching networks
 *   for a moment never sees the page (2026-09-29). The page reloads its address to go back.
 * - /_next/static is cache-first: those filenames carry a content hash, so they really are
 *   immutable and a changed file is a changed URL.
 * - /icons is stale-while-revalidate: the names are stable (icon-192.png), so a cached copy can
 *   be wrong. It is served at once to keep the shell working offline, and replaced in the
 *   background, so a changed icon heals itself on the next load instead of waiting for a human
 *   to remember to bump VERSION (task 1.5).
 * - The manifest is never cached here. It drives an installed app's name, icons and status-bar
 *   band, and a stale copy is invisible until someone reinstalls and finds the change missing.
 * - Never touches /api, non-GET requests or other origins, so Supabase and server actions are
 *   always live.
 * - Web Push (task 5.2, ADR-0009, WORKFLOWS §9a): `push` shows the notification with the full
 *   text the dispatcher sent (`core/notifications/push/send.ts` PushMessage: title, body, url,
 *   tag, notificationId); `notificationclick` opens its link through the deep-link entry
 *   (`/open?to=…`, ARCHITECTURE §14.2 h), focusing an open MaxOff window when there is one,
 *   so the record lands with its list underneath; `pushsubscriptionchange` re-subscribes and
 *   stores the new subscription through /api/push/subscription (no page may be open then).
 * - The launch screen (owner's walk note 3, 2026-10-08, ARCHITECTURE §14): an installed app's
 *   launch (`start_url` `/?source=pwa`, the manifest) whose document has not arrived within
 *   LAUNCH_SCREEN_AFTER_MS is answered with a static brand screen, built here (never a cached
 *   response of the app's), while the real request goes on. The screen hands over with
 *   `location.replace` to `/?launch=<id>`, which is answered with that same held response, so the
 *   server is asked once, nothing is added to history and nothing is cached. A launch whose
 *   document comes in time is answered exactly as before: no screen, no extra hop.
 * - The instant skeleton (P2, ADR-0014): the router's **prefetch** of a top-level destination
 *   (`SHELL_PATHS`), which carries only that screen's loading skeleton, is answered from
 *   `SHELL_CACHE` at once and refreshed from the network in the background, so a tap shows the
 *   skeleton even while a cold Worker takes seconds. Only those requests: never a page's data, a
 *   navigation, a server action, /api or another origin. Each copy is kept for one deployment
 *   (the request's `x-deployment-id`) and one viewer role (posted by the shell, `pwa-after-page`),
 *   and the whole cache is dropped on any signed-out page, a new role or a new deployment.
 *
 * Bump VERSION when the caching rules or the handlers change; the old cache is deleted on activate.
 */
const VERSION = "v11";
const CACHE = `maxoff-${VERSION}`;
const SHELL_CACHE = `maxoff-shell-${VERSION}`;
const OFFLINE_URL = "/offline";
/** A failed navigation waits this long, then is tried once more before the offline page. */
const NAVIGATION_RETRY_MS = 1500;
// The manifest is deliberately absent: see the header comment. It was precached but never
// served from cache, which is the worst of both — a trap for whoever widens the fetch handler.
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];
// The cached /offline page is refreshed once per worker lifetime (the browser stops an idle
// worker, so roughly once per session), not on every navigation.
let offlinePageRefreshed = false;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed filenames: a changed file is a changed URL, so a hit can never be stale. */
function isImmutableAsset(pathname) {
  return pathname.startsWith("/_next/static/");
}

/** Stable filenames that still need to work offline: serve the copy, then refresh it. */
function isRevalidatingAsset(pathname) {
  return pathname.startsWith("/icons/");
}

async function refreshOfflinePage() {
  if (offlinePageRefreshed) return;
  offlinePageRefreshed = true;
  try {
    const response = await fetch(OFFLINE_URL, { cache: "no-store" });
    // Only the real offline page is cached: never a redirect target such as /login (1.2).
    const isOfflinePage = !response.redirected && new URL(response.url).pathname === OFFLINE_URL;
    if (response.ok && isOfflinePage) {
      const cache = await caches.open(CACHE);
      await cache.put(OFFLINE_URL, response);
    }
  } catch {
    // Offline right now; the cached copy stays.
  }
}

/** A navigation that fails is tried once more: a network switch drops a few seconds at most. */
function fetchNavigation(request) {
  return fetch(request).catch(() =>
    new Promise((resolve) => setTimeout(resolve, NAVIGATION_RETRY_MS)).then(() => fetch(request)),
  );
}

async function offlineFallback() {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) return cached;
  return new Response("<!doctype html><title>Offline</title><p>MaxOff needs a connection.</p>", {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// The launch screen (walk note 3) -----------------------------------------------------------------

/** The installed app's `start_url` is `/?source=pwa` (manifest.webmanifest): only a launch has it. */
const LAUNCH_SOURCE = "pwa";
/** The launch screen's hand-off: `/?launch=<id>` takes the response held under that id. */
const HANDOFF_PARAM = "launch";
/**
 * A launch whose document has not arrived by then gets the launch screen. A warm Worker answers
 * `/` (a redirect from the cookie alone, 2.7) well inside it, so a warm launch never sees it; a
 * cold start (1.5–2 s, 2026-10-08) shows the screen instead of an empty window.
 */
const LAUNCH_SCREEN_AFTER_MS = 100;
/** A held response no hand-off came for (the window was closed) is let go after this long. */
const HANDOFF_WAIT_MS = 10000;
/** id → the launch's own response, still on its way; each is taken once, by its own hand-off. */
const heldLaunches = new Map();
/** Marks the launch screen's own response (it is not the network's: no offline-page refresh). */
const LAUNCH_SCREEN_HEADER = "X-MaxOff-Launch-Screen";

/**
 * What a request is to the launch: `"launch"` (the installed app opening, at its `start_url`),
 * `"handoff"` (the launch screen asking for the response held for it) or `null` (everything else:
 * in-app navigations, reloads, deep links, browser tabs; they are never touched).
 */
function launchStep(request) {
  if (request.method !== "GET" || request.mode !== "navigate") return null;
  // A top-level document only: never a frame.
  if (request.destination && request.destination !== "document") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== "/") return null;
  if (url.searchParams.get("source") === LAUNCH_SOURCE) return "launch";
  if (url.searchParams.has(HANDOFF_PARAM)) return "handoff";
  return null;
}

function newLaunchId() {
  const crypto = self.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * The launch screen: static and data-free (no request, no storage, nothing of a member's), drawn
 * like the launch intro's first frame (`core/ui/pwa/launch-intro.tsx`: the icon's mark, 144 CSS
 * px, centred, on the launch background) so the intro takes over from it unseen, plus a quiet
 * indicator that fades in only if the wait goes on. It hands over after its first frame.
 */
function launchScreen(id) {
  const target = `/?${HANDOFF_PARAM}=${encodeURIComponent(id)}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f5f2"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0b0c"><title>MaxOff</title><style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}[data-slot="launch-screen"]{position:fixed;inset:0;display:grid;place-items:center}[data-slot="launch-indicator"]{position:fixed;left:50%;top:calc(50% + 72px + 40px);display:flex;gap:8px;transform:translateX(-50%);opacity:0;animation:launch-indicator-in 300ms ease-out 400ms forwards}[data-slot="launch-indicator"] span{width:6px;height:6px;border-radius:50%;background:#ffffff;opacity:.35;animation:launch-indicator-pulse 1200ms ease-in-out infinite}[data-slot="launch-indicator"] span:nth-child(2){animation-delay:200ms}[data-slot="launch-indicator"] span:nth-child(3){animation-delay:400ms}@keyframes launch-indicator-in{to{opacity:1}}@keyframes launch-indicator-pulse{50%{opacity:.8}}@media (prefers-reduced-motion: reduce){[data-slot="launch-indicator"] span{animation:none}}</style></head><body><div data-slot="launch-screen" role="progressbar" aria-busy="true" aria-label="Opening MaxOff"><svg viewBox="0 0 512 512" width="144" height="144" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#c42126"/><path d="M132 372V152l124 128 124-128v220" fill="none" stroke="#ffffff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div data-slot="launch-indicator" aria-hidden="true"><span></span><span></span><span></span></div><script>(function(){var done=false;function go(){if(done)return;done=true;location.replace(${JSON.stringify(target)})}requestAnimationFrame(function(){setTimeout(go,0)});setTimeout(go,50)})();</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      [LAUNCH_SCREEN_HEADER]: "1",
    },
  });
}

/**
 * The launch: the network and a short timer race. The network first → its answer, as for any
 * navigation. The timer first → the launch screen, and the network's answer is held for the
 * screen's hand-off (the worker is kept alive until it settles).
 */
function answerLaunch(event, network) {
  event.waitUntil(
    network.then(
      () => undefined,
      () => undefined,
    ),
  );
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), LAUNCH_SCREEN_AFTER_MS);
  });
  const settled = network.then(
    (response) => ({ response }),
    (error) => ({ error }),
  );
  return Promise.race([settled, late]).then((first) => {
    if (first) {
      clearTimeout(timer);
      if ("error" in first) throw first.error;
      return first.response;
    }
    const id = newLaunchId();
    const expiry = setTimeout(() => heldLaunches.delete(id), HANDOFF_WAIT_MS);
    heldLaunches.set(id, { network, expiry });
    return launchScreen(id);
  });
}

/** The hand-off: its own launch's response, once; anything else is an ordinary navigation. */
function takeHeldLaunch(url) {
  const id = url.searchParams.get(HANDOFF_PARAM);
  const held = id === null ? undefined : heldLaunches.get(id);
  if (!held) return null;
  heldLaunches.delete(id);
  clearTimeout(held.expiry);
  return held.network;
}

// The instant skeleton (P2, ADR-0014) -------------------------------------------------------------

/**
 * The top-level destinations (the bar, the More sheet, home and Me) whose prefetch is proven to
 * carry no member data: the route tree and the loading skeleton, shaped by the viewer's role only
 * (`e2e/instant-skeleton.spec.ts` reads every one, for every role). Never a client's or a
 * person's page (their layouts read the record), never `/leave` (its layout hands the comp leave
 * balance and today's date to the page). Adding a path here needs that proof first.
 */
const SHELL_PATHS = new Set([
  "/approvals",
  "/tasks",
  "/calendar",
  "/clients",
  "/people",
  "/settings",
  "/me",
  "/notifications",
]);
/**
 * Drill-downs whose prefetch is the same proven skeleton for every record: a task's page has no
 * layout of its own and a static title, so its prefetch is the loading screen and the id from its
 * own address. One copy per task, so at most `SHELL_DRILL_DOWNS_KEPT` are kept, the oldest going.
 */
const SHELL_DRILL_DOWN = /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHELL_DRILL_DOWNS_KEPT = 60;
/**
 * The role the kept skeletons were drawn for (`pwa-after-page` posts it). Until the shell has
 * said, skeletons are kept but never answered: every one was fetched with the session of whoever
 * is signed in now, because any signed-out page dropped the cache before they signed in.
 */
const SHELL_VIEWER_KEY = "/__maxoff/shell-viewer";
/** When a skeleton was kept; one older than `SHELL_REFRESH_MS` is fetched again behind it. */
const SHELL_KEPT_AT_HEADER = "X-MaxOff-Shell-Kept-At";
const SHELL_REFRESH_MS = 60 * 60 * 1000;
/** The message the signed-in shell posts: `{ type, viewer }`, the viewer's role. */
const SHELL_VIEWER_MESSAGE = "maxoff-shell-viewer";
const SHELL_VIEWERS = new Set(["owner", "admin", "staff"]);
/** Pages only a signed-out visitor sees: reaching one drops every kept skeleton. */
const SIGNED_OUT_PAGES = new Set(["/login", "/forgot-password", "/set-password"]);
/** undefined: not read yet this worker's life; null: not known (nothing is answered). */
let shellViewer;
/** Counts the drops: a skeleton fetched before one is never kept after it. */
let shellGeneration = 0;
/** The deployment the kept skeletons belong to, once known this worker's life. */
let shellDeployment = null;

/**
 * The cache key of a request this worker answers with a kept skeleton, or null. Only the router's
 * prefetch (`RSC: 1` and `Next-Router-Prefetch: 1`, never a navigation's or a refresh's request)
 * of a `SHELL_PATHS` or `SHELL_DRILL_DOWN` address with no query but the router's own `_rsc`,
 * from a page that names its deployment.
 *
 * Keyed by what the answer varies by (the server's `Vary`: the segment asked for and the router
 * state tree; `RSC` and `Next-Router-Prefetch` are fixed above), never by `_rsc` itself: `_rsc`
 * also hashes `Next-Url`, the page the prefetch was made **from**, which a route without an
 * interception route ignores (the server drops the header). Keyed by `_rsc`, a skeleton kept
 * while on Today never answered the same prefetch made on Tasks, so a task row tapped there after
 * a cold reopen waited for the Worker. A response that does vary by `Next-Url` is never kept
 * (`isShellPayload`).
 */
function shellKey(request) {
  if (request.method !== "GET" || request.mode === "navigate") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (!SHELL_PATHS.has(url.pathname) && !SHELL_DRILL_DOWN.test(url.pathname)) return null;
  const headers = request.headers;
  if (headers.get("rsc") !== "1" || headers.get("next-router-prefetch") !== "1") return null;
  const deployment = headers.get("x-deployment-id");
  const rsc = url.searchParams.get("_rsc");
  if (!deployment || !rsc || [...url.searchParams.keys()].length !== 1) return null;
  const key = new URL(url.pathname, self.location.origin);
  key.searchParams.set("segment", headers.get("next-router-segment-prefetch") ?? "");
  key.searchParams.set("tree", requestTreeKey(headers.get("next-router-state-tree") ?? ""));
  key.searchParams.set("dpl", deployment);
  return key.href;
}

/**
 * The router state tree as the cache key holds it: the router's "inside-shared-layout" marks
 * read as no mark. The router sends one where the destination leaves the page it is asked from
 * and that part is already in its memory, and none when it is asked from under the same part
 * (a task's row on Today or on Tasks): the server uses the mark only to begin looking for a
 * loading boundary, and every kept address has its own below it, so both requests render from
 * the same "refetch" mark down and get the same skeleton. Without this, a task's skeleton kept
 * from Today never answered the same task tapped on Tasks after a cold reopen (seconds on a cold
 * Worker). Any other tree is kept as sent.
 */
function requestTreeKey(header) {
  if (!header.includes("inside-shared-layout")) return header;
  try {
    const unmark = (node) => {
      if (!Array.isArray(node)) return node;
      const copy = node.slice();
      if (copy[3] === "inside-shared-layout") copy[3] = null;
      const children = copy[1];
      if (children && typeof children === "object" && !Array.isArray(children)) {
        copy[1] = Object.fromEntries(
          Object.entries(children).map(([slot, child]) => [slot, unmark(child)]),
        );
      }
      return copy;
    };
    return encodeURIComponent(JSON.stringify(unmark(JSON.parse(decodeURIComponent(header)))));
  } catch {
    return header;
  }
}

async function readShellViewer() {
  if (shellViewer !== undefined) return shellViewer;
  const stored = await caches.match(SHELL_VIEWER_KEY, { cacheName: SHELL_CACHE });
  const viewer = stored ? await stored.text() : null;
  // A message that arrived while this was read wins.
  if (shellViewer === undefined) shellViewer = SHELL_VIEWERS.has(viewer) ? viewer : null;
  return shellViewer;
}

/** Drops every kept skeleton; the viewer is not known again until the shell says. */
async function dropShell() {
  shellGeneration += 1;
  shellViewer = null;
  shellDeployment = null;
  await caches.delete(SHELL_CACHE);
}

/**
 * The shell names its viewer's role. The first name after a drop adopts what was kept meanwhile
 * (the same session fetched it); a different role than the one named before drops it all.
 */
async function setShellViewer(viewer) {
  if (!SHELL_VIEWERS.has(viewer)) {
    await dropShell();
    return;
  }
  const current = await readShellViewer();
  if (current === viewer) return;
  if (current !== null) await dropShell();
  shellViewer = viewer;
  await (await caches.open(SHELL_CACHE)).put(SHELL_VIEWER_KEY, new Response(viewer));
}

/** The worker's own clock in ms, to age a kept skeleton (no business date is read here). */
function nowMs() {
  return self.performance.timeOrigin + self.performance.now();
}

/** The path a response came from, or null when it does not say. */
function responsePath(response) {
  try {
    return new URL(response.url).pathname;
  } catch {
    return null;
  }
}

/**
 * The network's answer is a skeleton worth keeping: the prefetch itself, answered in full, and
 * the same whichever page asked (`shellKey` leaves `Next-Url` out).
 */
function isShellPayload(request, response) {
  if (response.status !== 200 || response.redirected) return false;
  if (responsePath(response) !== new URL(request.url).pathname) return false;
  if (/(^|,)\s*next-url\s*(,|$)/i.test(response.headers.get("vary") || "")) return false;
  return (response.headers.get("content-type") || "").startsWith("text/x-component");
}

/** Keeps the network's skeleton for this deployment (another deployment's go), unless dropped since. */
async function storeShell(key, request, response, generation) {
  if (!isShellPayload(request, response)) {
    // Sent to sign in: the session these skeletons were fetched with has ended.
    if (response.redirected && SIGNED_OUT_PAGES.has(responsePath(response))) await dropShell();
    return;
  }
  const body = await response.arrayBuffer();
  if (generation !== shellGeneration) return;
  const cache = await caches.open(SHELL_CACHE);
  const deployment = new URL(key).searchParams.get("dpl");
  if (shellDeployment !== deployment) {
    for (const old of await cache.keys()) {
      const oldUrl = new URL(old.url);
      if (oldUrl.pathname !== SHELL_VIEWER_KEY && oldUrl.searchParams.get("dpl") !== deployment) {
        await cache.delete(old);
      }
    }
    shellDeployment = deployment;
  }
  const headers = new Headers(response.headers);
  headers.delete("vary");
  headers.delete("set-cookie");
  headers.set(SHELL_KEPT_AT_HEADER, String(nowMs()));
  if (generation !== shellGeneration) return;
  await cache.delete(key);
  await cache.put(key, new Response(body, { status: 200, headers }));
  if (SHELL_DRILL_DOWN.test(new URL(key).pathname)) await pruneDrillDowns(cache);
}

/** Keeps the newest `SHELL_DRILL_DOWNS_KEPT` drill-down skeletons (keys list oldest first). */
async function pruneDrillDowns(cache) {
  const kept = (await cache.keys()).filter((request) =>
    SHELL_DRILL_DOWN.test(new URL(request.url).pathname),
  );
  for (const old of kept.slice(0, Math.max(0, kept.length - SHELL_DRILL_DOWNS_KEPT))) {
    await cache.delete(old);
  }
}

/**
 * A kept skeleton answers at once once the viewer is known; with none, the network answers (and is
 * kept). Within one deployment and one role a skeleton never changes (it is the build's own loading
 * screen and route tree), so a copy younger than `SHELL_REFRESH_MS` answers alone and the Worker is
 * not asked at all; an older one answers and the network's replaces it for next time.
 */
async function answerShell(event, request, key) {
  const generation = shellGeneration;
  const viewer = await readShellViewer();
  const cached = viewer ? await caches.match(key, { cacheName: SHELL_CACHE }) : undefined;
  const fromNetwork = () =>
    fetch(request).then((response) => {
      event.waitUntil(
        storeShell(key, request, response.clone(), generation).catch(() => undefined),
      );
      return response;
    });
  if (!cached) return fromNetwork();
  const keptAt = Number(cached.headers.get(SHELL_KEPT_AT_HEADER)) || 0;
  if (nowMs() - keptAt >= SHELL_REFRESH_MS) {
    event.waitUntil(
      fromNetwork().then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return cached;
}

/** Whether a navigation reaches a page only a signed-out visitor sees. */
function isSignedOutNavigation(url) {
  return SIGNED_OUT_PAGES.has(url.pathname) || url.pathname.startsWith("/auth/");
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== SHELL_VIEWER_MESSAGE) return;
  event.waitUntil(setShellViewer(data.viewer).catch(() => undefined));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    const step = launchStep(request);
    const held = step === "handoff" ? takeHeldLaunch(url) : null;
    // A signed-out page (signing out, an ended session's redirect, a sign-in, an auth link): the
    // skeletons kept for whoever was here before go, before the next person signs in.
    if (isSignedOutNavigation(url)) event.waitUntil(dropShell().catch(() => undefined));
    const answer =
      step === "launch"
        ? answerLaunch(event, fetchNavigation(request))
        : (held ?? fetchNavigation(request));
    event.respondWith(
      answer
        .then((response) => {
          // A deploy changes the asset hashes inside /offline; keep the cached copy current.
          const fromNetwork = !response.headers.has(LAUNCH_SCREEN_HEADER);
          if (response.ok && fromNetwork && url.pathname !== OFFLINE_URL) {
            event.waitUntil(refreshOfflinePage());
          }
          return response;
        })
        .catch(offlineFallback),
    );
    return;
  }

  const shell = shellKey(request);
  if (shell) {
    event.respondWith(answerShell(event, request, shell));
    return;
  }

  const cacheAndReturn = (response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  };

  if (isImmutableAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then(cacheAndReturn)),
    );
    return;
  }

  if (isRevalidatingAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Stale-while-revalidate: the cached icon answers now, the network copy replaces it for
        // next time. Offline keeps working, and a changed icon is at most one load behind.
        const fresh = fetch(request).then(cacheAndReturn);
        if (!cached) return fresh;
        event.waitUntil(fresh.catch(() => {}));
        return cached;
      }),
    );
  }
});

// Web Push (5.2) ---------------------------------------------------------------------------------

const NOTIFICATIONS_URL = "/notifications";
/**
 * The status-bar badge: the M alone, white on transparent (public/icons/badge.svg). Android draws a
 * notification's small icon from its alpha, so the full-colour app icon showed as a white square.
 */
const BADGE_URL = "/icons/badge-96.png";
/**
 * The large picture (owner decision 2026-10-02): Chrome on Android cannot leave it empty (with no
 * `icon` it drew a grey disc with the origin's first letter), and the app icon there doubled the
 * M. So it is one of a few fixed images by the notification's group: the payload names the group
 * (`notifyGroupFor`, core/notifications/push/groups.ts), never a URL, and this maps it to a
 * same-origin path; an unknown or missing group shows "other". Nothing personal, nothing behind
 * auth (public/icons/notify/, scripts/generate-notify-icons.mjs).
 */
const NOTIFY_ICONS = {
  tasks: "/icons/notify/tasks.png",
  approvals: "/icons/notify/approvals.png",
  leave: "/icons/notify/leave.png",
  reminders: "/icons/notify/reminders.png",
  reports: "/icons/notify/reports.png",
  other: "/icons/notify/other.png",
};

function iconFor(group) {
  return typeof group === "string" && Object.prototype.hasOwnProperty.call(NOTIFY_ICONS, group)
    ? NOTIFY_ICONS[group]
    : NOTIFY_ICONS.other;
}

/** The dispatcher's JSON, or a bare-text fallback: a push with no payload still shows something. */
function readPushMessage(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === "string") return data;
  } catch {
    // Not JSON: fall through.
  }
  const text = event.data ? event.data.text() : "";
  return {
    title: "MaxOff",
    body: text || null,
    url: NOTIFICATIONS_URL,
    tag: null,
    notificationId: null,
    group: "other",
  };
}

self.addEventListener("push", (event) => {
  const message = readPushMessage(event);
  const options = {
    body: message.body || undefined,
    icon: iconFor(message.group),
    badge: BADGE_URL,
    tag: message.tag || undefined,
    // A newer push with the same tag replaces the older quietly: no second buzz for the same
    // notification, one buzz for a fresh one.
    renotify: false,
    data: { url: typeof message.url === "string" ? message.url : NOTIFICATIONS_URL },
  };
  event.waitUntil(self.registration.showNotification(message.title, options));
});

/** The deep-link entry for a link (`core/ui/navigation/deep-link.ts` openUrl). */
function openUrlFor(path) {
  const safe =
    typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
      ? path
      : NOTIFICATIONS_URL;
  return `${self.location.origin}/open?to=${encodeURIComponent(safe)}`;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = openUrlFor(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // An open MaxOff window is brought forward and sent to the entry, so the app keeps its
      // state; otherwise a window is opened on it.
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        return open.focus().then((focused) => {
          const client = focused || open;
          return "navigate" in client ? client.navigate(target) : null;
        });
      }
      return self.clients.openWindow(target);
    }),
  );
});

/** The subscription the push service replaced, stored for the signed-in member of this browser. */
async function storeSubscription(subscription) {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) return;
  const encode = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const ua = self.navigator.userAgent || "";
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : /Windows|Macintosh|Linux|CrOS/.test(ua)
        ? "desktop"
        : "other";
  await fetch("/api/push/subscription", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh: encode(p256dh),
      auth: encode(auth),
      platform,
      // The worker cannot tell an installed window from a tab; the next page load corrects it.
      isStandalone: false,
      label: null,
      userAgent: ua.slice(0, 512),
    }),
  });
}

self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  const key = old && old.options ? old.options.applicationServerKey : null;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(storeSubscription)
      .catch(() => {
        // The next signed-in page load re-subscribes (PushSync).
      }),
  );
});
