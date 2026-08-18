import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toOrigin, resolvePublicOrigins } from "./public-origin.ts";

describe("toOrigin", () => {
  test("adds https to a bare domain, the shape Replit reports", () => {
    assert.equal(toOrigin("thought-catcher--antonktoshev.replit.app"),
      "https://thought-catcher--antonktoshev.replit.app");
  });

  test("keeps an explicit scheme", () => {
    assert.equal(toOrigin("https://example.com"), "https://example.com");
  });

  test("uses http for loopback, which is never served over TLS", () => {
    assert.equal(toOrigin("localhost:5000"), "http://localhost:5000");
    assert.equal(toOrigin("127.0.0.1:5000"), "http://127.0.0.1:5000");
  });

  test("strips the trailing slash a copy-paste leaves behind", () => {
    // Google matches redirect URIs character for character, so this one
    // character is the difference between working and redirect_uri_mismatch.
    assert.equal(toOrigin("https://example.com/"), "https://example.com");
  });

  test("strips surrounding whitespace", () => {
    assert.equal(toOrigin("  https://example.com  "), "https://example.com");
  });

  test("drops a path, leaving only the origin", () => {
    assert.equal(toOrigin("https://example.com/api/auth"), "https://example.com");
  });

  test("rejects empty and missing values", () => {
    assert.equal(toOrigin(undefined), null);
    assert.equal(toOrigin(""), null);
    assert.equal(toOrigin("   "), null);
  });

  test("rejects non-http schemes", () => {
    assert.equal(toOrigin("javascript:alert(1)"), null);
    assert.equal(toOrigin("file:///etc/passwd"), null);
    assert.equal(toOrigin("data:text/html,x"), null);
  });
});

describe("resolvePublicOrigins", () => {
  test("BETTER_AUTH_URL wins over everything else", () => {
    const r = resolvePublicOrigins({
      BETTER_AUTH_URL: "https://forced.example",
      REPLIT_DOMAINS: "auto.replit.app",
    } as NodeJS.ProcessEnv);
    assert.equal(r.baseURL, "https://forced.example");
    assert.equal(r.source, "BETTER_AUTH_URL");
  });

  test("falls back to the deployed domain Replit reports", () => {
    const r = resolvePublicOrigins({
      REPLIT_DOMAINS: "thought-catcher--antonktoshev.replit.app",
    } as NodeJS.ProcessEnv);
    assert.equal(r.baseURL, "https://thought-catcher--antonktoshev.replit.app");
    assert.equal(r.source, "REPLIT_DOMAINS");
  });

  test("defers to proxy headers when the environment says nothing", () => {
    const r = resolvePublicOrigins({} as NodeJS.ProcessEnv);
    assert.equal(r.baseURL, undefined);
    assert.equal(r.source, "proxy-headers");
    assert.deepEqual(r.trustedOrigins, []);
  });

  test("trusts the preview domain alongside the deployed one", () => {
    // This is the case that broke by hand: setting the production URL made the
    // Replit preview an untrusted origin, so sign-in there started failing.
    const r = resolvePublicOrigins({
      BETTER_AUTH_URL: "https://thought-catcher--antonktoshev.replit.app",
      REPLIT_DEV_DOMAIN: "abc-123.picard.replit.dev",
    } as NodeJS.ProcessEnv);
    assert.ok(r.trustedOrigins.includes("https://thought-catcher--antonktoshev.replit.app"));
    assert.ok(r.trustedOrigins.includes("https://abc-123.picard.replit.dev"));
  });

  test("handles the multi-domain list Replit can report", () => {
    const r = resolvePublicOrigins({
      REPLIT_DOMAINS: "one.replit.app,two.replit.app",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(r.trustedOrigins, ["https://one.replit.app", "https://two.replit.app"]);
  });

  test("does not list the same origin twice", () => {
    const r = resolvePublicOrigins({
      BETTER_AUTH_URL: "https://same.replit.app/",
      REPLIT_DOMAINS: "same.replit.app",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(r.trustedOrigins, ["https://same.replit.app"]);
  });

  test("ignores a malformed entry instead of trusting it", () => {
    const r = resolvePublicOrigins({
      REPLIT_DOMAINS: "good.replit.app,,   ,javascript:alert(1)",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(r.trustedOrigins, ["https://good.replit.app"]);
  });
});
