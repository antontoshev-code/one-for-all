/**
 * Service worker: makes the app open without a connection.
 *
 * The whole design turns on one rule — NOTHING PERSONAL IS EVER CACHED. Only
 * the application itself is stored: HTML, JavaScript, CSS, icons. Every request
 * to /api goes to the network and is never written to a cache, so a diary entry
 * cannot be served from disk to the wrong person, cannot be shown stale, and
 * cannot survive signing out. A cached shell with no data in it is the version
 * of offline support that cannot leak.
 *
 * That is a deliberate limit, not an oversight. Caching entries would let the
 * app show a diary offline, and it would also mean somebody's writing sitting
 * in browser storage after they signed out, on a device that may not be theirs.
 * Not worth it for a feature nobody asked for.
 *
 * What this does buy: the app opens instantly and works offline far enough to
 * record a thought — which for a voice-first app used on a walk is the case
 * that matters.
 */

// The routing rule lives in its own file so it can be tested — the guarantee
// that nothing personal is cached is the one thing here that must not be wrong,
// and a comment claiming it is not the same as knowing it.
importScripts("/sw-policy.js");

// Bumping this name is how old caches are discarded. It must change whenever
// the set of precached files changes, or a stale shell survives a deploy.
const CACHE = "one-for-all-shell-v1";

/**
 * The minimum needed to boot. Hashed assets are not listed — their names change
 * on every build, so they are cached as they are requested instead.
 */
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // Individually, so one missing file does not fail the whole install and
      // leave the app with no service worker at all.
      Promise.allSettled(SHELL.map(url => cache.add(url))),
    ),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const strategy = cacheStrategy(request, self.location.origin);

  // The worker does not intervene at all. Anything under /api takes this path,
  // which is what keeps personal data off the device.
  if (strategy === "passthrough") return;

  if (strategy === "network-first") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then(hit => hit ?? Response.error())),
    );
    return;
  }

  // cache-first: fingerprinted assets, where a URL always means the same bytes.
  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;

      return fetch(request).then(response => {
        // Only complete, successful, same-origin responses. Storing an opaque
        // or partial one means serving a broken file from then on.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

/**
 * Clear everything on request.
 *
 * Signing out empties the cache, so nothing the app rendered for one person is
 * left on the device for the next. There is no personal data in there by
 * design, but the shell is cheap to refetch and certainty is worth more than
 * one avoided download.
 */
self.addEventListener("message", event => {
  if (event.data === "clear-cache") {
    event.waitUntil(caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))));
  }
});
