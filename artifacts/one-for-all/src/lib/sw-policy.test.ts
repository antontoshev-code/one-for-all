import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exercises the service worker's caching rule.
 *
 * The rule that nothing personal is ever cached is the one part of offline
 * support that must not be wrong: a mistake there means one person's diary
 * served to another, or shown after they signed out. A comment saying so is not
 * the same as knowing it holds.
 *
 * The policy is a plain script, evaluated here rather than imported, because the
 * service worker loads it with importScripts and cannot be a module.
 */

const here = dirname(fileURLToPath(import.meta.url));
const POLICY = join(here, "../../public/sw-policy.js");

const ORIGIN = "https://thought-catcher--antonktoshev.replit.app";

type Strategy = "passthrough" | "network-first" | "cache-first";
let cacheStrategy: (
  request: { url: string; method: string; mode: string },
  origin: string,
) => Strategy;

before(() => {
  // eslint-disable-next-line no-eval
  (0, eval)(readFileSync(POLICY, "utf8"));
  cacheStrategy = (globalThis as unknown as { cacheStrategy: typeof cacheStrategy }).cacheStrategy;
  assert.equal(typeof cacheStrategy, "function", "policy did not define cacheStrategy");
});

function get(path: string, mode = "cors"): { url: string; method: string; mode: string } {
  return { url: `${ORIGIN}${path}`, method: "GET", mode };
}

describe("service worker caching policy", () => {
  describe("nothing personal is ever cached", () => {
    for (const path of [
      "/api/entries",
      "/api/entries/42",
      "/api/people",
      "/api/captures",
      "/api/data/export",
      "/api/auth/get-session",
      "/api/vocabulary",
      "/api",
    ]) {
      test(`${path} is never touched`, () => {
        assert.equal(cacheStrategy(get(path), ORIGIN), "passthrough");
      });
    }

    test("a path merely containing 'api' is not mistaken for the API", () => {
      // "/assets/rapid-x.js" must still be cacheable; the check is on the
      // path segment, not on the substring.
      assert.equal(cacheStrategy(get("/assets/rapid-x.js"), ORIGIN), "cache-first");
    });
  });

  describe("actions are never replayed", () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      test(`${method} passes through`, () => {
        assert.equal(
          cacheStrategy({ url: `${ORIGIN}/assets/index.js`, method, mode: "cors" }, ORIGIN),
          "passthrough",
        );
      });
    }
  });

  describe("other origins are left alone", () => {
    test("a third-party request is not intercepted", () => {
      assert.equal(
        cacheStrategy(
          { url: "https://fonts.googleapis.com/css2?family=Inter", method: "GET", mode: "cors" },
          ORIGIN,
        ),
        "passthrough",
      );
    });

    test("another Replit app on a different host is not intercepted", () => {
      assert.equal(
        cacheStrategy({ url: "https://someone-else.replit.app/api/entries", method: "GET", mode: "cors" }, ORIGIN),
        "passthrough",
      );
    });
  });

  describe("the app itself", () => {
    test("a navigation goes to the network first", () => {
      // Cache-first would serve an old index.html naming asset hashes that no
      // longer exist — a blank screen rather than a stale page.
      assert.equal(cacheStrategy(get("/", "navigate"), ORIGIN), "network-first");
      assert.equal(cacheStrategy(get("/people", "navigate"), ORIGIN), "network-first");
    });

    test("fingerprinted assets come from cache first", () => {
      assert.equal(cacheStrategy(get("/assets/index-CBWAXqXh.css"), ORIGIN), "cache-first");
      assert.equal(cacheStrategy(get("/assets/index-DxHc8ELh.js"), ORIGIN), "cache-first");
      assert.equal(cacheStrategy(get("/icon-192.png"), ORIGIN), "cache-first");
      assert.equal(cacheStrategy(get("/manifest.webmanifest"), ORIGIN), "cache-first");
    });
  });

  test("a malformed URL is passed through rather than throwing", () => {
    // A worker that throws in its fetch handler breaks every request on the page.
    assert.equal(cacheStrategy({ url: "not a url", method: "GET", mode: "cors" }, ORIGIN), "passthrough");
  });
});
