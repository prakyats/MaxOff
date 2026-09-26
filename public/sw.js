/*
 * MaxOff service worker (task 0.5, ARCHITECTURE §14): a minimal offline shell.
 *
 * - Precaches the /offline page and serves it when a navigation fails without a connection.
 * - /_next/static is cache-first: those filenames carry a content hash, so they really are
 *   immutable and a changed file is a changed URL.
 * - /icons is stale-while-revalidate: the names are stable (icon-192.png), so a cached copy can
 *   be wrong. It is served at once to keep the shell working offline, and replaced in the
 *   background, so a changed icon heals itself on the next load instead of waiting for a human
 *   to remember to bump VERSION (task 1.5).
 * - The manifest is never cached here. It drives an installed app's name, icons and status-bar
 *   band, and a stale copy is invisible until someone reinstalls and finds the change missing.
 * - Never touches /api, non-GET requests or other origins, so Supabase and server actions are
 *   always live. Push handlers arrive with core/notifications (task 5.1).
 *
 * Bump VERSION when the caching rules change; the old cache is deleted on activate.
 */
const VERSION = "v3";
const CACHE = `maxoff-${VERSION}`;
const OFFLINE_URL = "/offline";
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
