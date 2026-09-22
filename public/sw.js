/*
 * MaxOff service worker (task 0.5, ARCHITECTURE §14): a minimal offline shell.
 *
 * - Precaches the /offline page and serves it when a navigation fails without a connection.
 * - Caches hashed static assets (/_next/static, /icons) cache-first, since they are immutable.
 * - Never touches /api, non-GET requests or other origins, so Supabase and server actions are
 *   always live. Push handlers arrive with core/notifications (task 5.1).
 *
 * Bump VERSION when the caching rules change or an icon changes (icons are cache-first for
 * ever); the old cache is deleted on activate.
 */
const VERSION = "v1";
const CACHE = `maxoff-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png"];
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

function isImmutableAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");
}

async function refreshOfflinePage() {
  if (offlinePageRefreshed) return;
  offlinePageRefreshed = true;
  try {
    const response = await fetch(OFFLINE_URL, { cache: "no-store" });
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(OFFLINE_URL, response);
    }
  } catch {
    // Offline right now; the cached copy stays.
  }
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
      fetch(request)
        .then((response) => {
          // A deploy changes the asset hashes inside /offline; keep the cached copy current.
          if (response.ok && url.pathname !== OFFLINE_URL) event.waitUntil(refreshOfflinePage());
          return response;
        })
        .catch(offlineFallback),
    );
    return;
  }

  if (isImmutableAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
            }
            return response;
          }),
      ),
    );
  }
});
