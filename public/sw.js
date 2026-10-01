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
 *
 * Bump VERSION when the caching rules or the handlers change; the old cache is deleted on activate.
 */
const VERSION = "v6";
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetchNavigation(request)
        .then((response) => {
          // A deploy changes the asset hashes inside /offline; keep the cached copy current.
          if (response.ok && url.pathname !== OFFLINE_URL) event.waitUntil(refreshOfflinePage());
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
 * No `icon` (large picture) is sent: the installed app already shows its own icon beside every
 * notification, so an `icon` drew a second M (owner's phone test, 2026-10-01).
 */
const BADGE_URL = "/icons/badge-96.png";

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
  };
}

self.addEventListener("push", (event) => {
  const message = readPushMessage(event);
  const options = {
    body: message.body || undefined,
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
