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
 *
 * Bump VERSION when the caching rules or the handlers change; the old cache is deleted on activate.
 */
const VERSION = "v8";
const CACHE = `maxoff-${VERSION}`;
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
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#fafaf9"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0b0c"><title>MaxOff</title><style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}[data-slot="launch-screen"]{position:fixed;inset:0;display:grid;place-items:center}[data-slot="launch-indicator"]{position:fixed;left:50%;top:calc(50% + 72px + 40px);display:flex;gap:8px;transform:translateX(-50%);opacity:0;animation:launch-indicator-in 300ms ease-out 400ms forwards}[data-slot="launch-indicator"] span{width:6px;height:6px;border-radius:50%;background:#ffffff;opacity:.35;animation:launch-indicator-pulse 1200ms ease-in-out infinite}[data-slot="launch-indicator"] span:nth-child(2){animation-delay:200ms}[data-slot="launch-indicator"] span:nth-child(3){animation-delay:400ms}@keyframes launch-indicator-in{to{opacity:1}}@keyframes launch-indicator-pulse{50%{opacity:.8}}@media (prefers-reduced-motion: reduce){[data-slot="launch-indicator"] span{animation:none}}</style></head><body><div data-slot="launch-screen" role="progressbar" aria-busy="true" aria-label="Opening MaxOff"><svg viewBox="0 0 512 512" width="144" height="144" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#c42126"/><path d="M132 372V152l124 128 124-128v220" fill="none" stroke="#ffffff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div data-slot="launch-indicator" aria-hidden="true"><span></span><span></span><span></span></div><script>(function(){var done=false;function go(){if(done)return;done=true;location.replace(${JSON.stringify(target)})}requestAnimationFrame(function(){setTimeout(go,0)});setTimeout(go,50)})();</script></body></html>`;
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    const step = launchStep(request);
    const held = step === "handoff" ? takeHeldLaunch(url) : null;
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
