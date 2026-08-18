/**
 * Thin wrappers over Better Auth's REST endpoints.
 *
 * Deliberately plain fetch rather than better-auth's React client: pulling the
 * library into the frontend re-introduces the dependency it drags in on the
 * server (kysely), and drizzle's optional peers make that split its types.
 * These endpoints are a stable contract, so the wrappers cost little.
 *
 * Session state lives in an httpOnly cookie the browser sends automatically —
 * no token is ever held in JS, so nothing here can leak one to an XSS payload.
 * Every call therefore needs `credentials: "include"`.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

interface AuthResult {
  ok: boolean;
  /** Human-readable and safe to show; never contains which field was wrong. */
  error?: string;
}

const BASE = "/api/auth";

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
}

/** Pull a readable message out of Better Auth's error shape. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.message || data?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function getSession(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/get-session`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export async function signUp(name: string, email: string, password: string): Promise<AuthResult> {
  const res = await post("/sign-up/email", { name, email, password });
  if (res.ok) return { ok: true };
  return { ok: false, error: await errorFrom(res, "Could not create the account.") };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const res = await post("/sign-in/email", { email, password });
  if (res.ok) return { ok: true };
  // Deliberately not distinguishing "no such account" from "wrong password" —
  // that difference tells an attacker which emails are registered.
  return { ok: false, error: await errorFrom(res, "Email or password is incorrect.") };
}

export async function signOut(): Promise<void> {
  try {
    await post("/sign-out", {});
  } catch {
    // Ignore — the caller reloads regardless, and an expired session is
    // already signed out as far as the user is concerned.
  }
}

/**
 * Starts the Google flow. The server returns the consent URL to redirect to;
 * Google sends the user back to callbackURL once they approve.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const res = await post("/sign-in/social", {
      provider: "google",
      callbackURL: window.location.origin,
    });
    if (!res.ok) return { ok: false, error: await errorFrom(res, "Google sign-in is unavailable.") };

    const { url } = await res.json() as { url?: string };
    if (!url) return { ok: false, error: "Google sign-in is unavailable." };

    window.location.href = url;
    return { ok: true };
  } catch {
    return { ok: false, error: "Google sign-in is unavailable." };
  }
}
