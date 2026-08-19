/**
 * Works out the app's own public address.
 *
 * Behind Replit's proxy the server sees an internal request URL, so anything
 * derived from it is wrong in the two places it matters most:
 *
 *   - the redirect_uri sent to Google, which must match the console entry
 *     character for character or sign-in fails with redirect_uri_mismatch;
 *   - the trusted-origin list, which is CSRF protection — a mismatch makes
 *     every sign-in POST fail with a bare "forbidden".
 *
 * Getting it from a hand-entered environment variable put the whole of sign-in
 * behind a value nobody would think to check, and one that differs between the
 * preview and the published app. So we derive it instead, and only fall back to
 * the manual override when the derivation has nothing to work with.
 */

/**
 * Turn a bare domain or a full URL into an origin, or null if it is neither.
 *
 * Replit hands these over as bare domains (`foo.replit.app`), whereas a
 * hand-set BETTER_AUTH_URL is usually a full URL, and either may arrive with a
 * trailing slash or stray whitespace from a copy-paste.
 */
export function toOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  // Reject anything carrying a scheme we don't serve over. Testing for "starts
  // with http" is not enough: "file:///etc/passwd" fails that test, so it would
  // be treated as a bare domain, and prefixing it yields the parseable — and
  // very much trusted — origin "https://file".
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") {
    // A bare "localhost:5000" looks like a scheme to that pattern, so let a
    // numeric port through before rejecting.
    if (!/^[a-z0-9.-]+:\d+$/i.test(trimmed)) return null;
  }

  // Bare domain: assume https, except for loopback which is never served over TLS.
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${/^(localhost|127\.0\.0\.1)(:|$)/i.test(trimmed) ? "http" : "https"}://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Split a comma-separated env var into origins, dropping anything unparseable. */
function originList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map(toOrigin).filter((o): o is string => o !== null);
}

export interface PublicOrigins {
  /**
   * The canonical public origin, or undefined to let Better Auth derive it
   * per-request from the proxy headers.
   */
  baseURL: string | undefined;
  /** Every origin allowed to post to the auth endpoints. */
  trustedOrigins: string[];
  /** Where baseURL came from — logged at startup so a wrong value is visible. */
  source: "BETTER_AUTH_URL" | "REPLIT_DOMAINS" | "proxy-headers";
}

/**
 * Resolve the public origins from the environment.
 *
 * Precedence is deliberate: an explicit BETTER_AUTH_URL always wins, so the
 * value can be forced if a host ever reports something misleading. Replit's own
 * variables come next, and if neither exists we hand the job to Better Auth's
 * proxy-header resolution rather than guessing.
 *
 * The preview domain is always trusted when present, even in the published app.
 * It costs nothing — it is an origin Anton controls — and it means the preview
 * keeps working regardless of which value ends up canonical.
 */
export function resolvePublicOrigins(env: NodeJS.ProcessEnv = process.env): PublicOrigins {
  const explicit = toOrigin(env.BETTER_AUTH_URL);
  const deployed = originList(env.REPLIT_DOMAINS);
  const preview = toOrigin(env.REPLIT_DEV_DOMAIN);

  const baseURL = explicit ?? deployed[0];

  const source: PublicOrigins["source"] = explicit
    ? "BETTER_AUTH_URL"
    : deployed.length
      ? "REPLIT_DOMAINS"
      : "proxy-headers";

  // Set keeps insertion order and drops the duplicates that appear whenever
  // BETTER_AUTH_URL names the same host Replit already reported.
  const trustedOrigins = [...new Set(
    [explicit, ...deployed, preview].filter((o): o is string => o !== null && o !== undefined),
  )];

  return { baseURL, trustedOrigins, source };
}
