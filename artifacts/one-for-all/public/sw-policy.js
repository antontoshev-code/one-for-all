/**
 * Decides what the service worker does with a request.
 *
 * Split out from sw.js so it can be tested. The rule it encodes — that nothing
 * personal is ever written to a cache — is the one thing in the offline support
 * that must not be got wrong, and "there is a comment saying so" is not the same
 * as knowing it holds.
 *
 * Written as a plain script rather than a module so a classic service worker can
 * importScripts() it, and so a test can evaluate it directly.
 */
(function (root) {
  /**
   * @param {{ url: string, method: string, mode: string }} request
   * @param {string} origin - the app's own origin
   * @returns {"passthrough" | "network-first" | "cache-first"}
   *   passthrough  — the worker does not intervene; nothing is read or written
   *   network-first — try the network, fall back to the cached shell
   *   cache-first   — serve from cache when present, otherwise fetch and store
   */
  function cacheStrategy(request, origin) {
    // A POST, PATCH or DELETE is an action. Replaying one from a cache would
    // repeat something the user did once.
    if (request.method !== "GET") return "passthrough";

    var url;
    try {
      url = new URL(request.url);
    } catch (_err) {
      return "passthrough";
    }

    // Somebody else's server is theirs to answer for.
    if (url.origin !== origin) return "passthrough";

    // Everything personal lives under /api. None of it is cached, read from a
    // cache, or left on the device — so a diary entry cannot be served to the
    // wrong person, shown stale, or outlive signing out.
    if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return "passthrough";

    // The document itself: network first, so a new deploy is picked up at once.
    // Cache-first here would serve an old index.html naming asset hashes that no
    // longer exist, which is a blank screen rather than a stale page.
    if (request.mode === "navigate") return "network-first";

    // Everything else is a fingerprinted asset: the URL always means the same
    // bytes, so it can be trusted from disk indefinitely.
    return "cache-first";
  }

  root.cacheStrategy = cacheStrategy;
})(typeof self !== "undefined" ? self : globalThis);
