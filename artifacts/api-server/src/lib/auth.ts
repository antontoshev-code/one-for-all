import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  db, userTable, sessionTable, accountTable, verificationTable,
  entriesTable, peopleTable, capturesTable, isNull, eq, sql,
} from "@workspace/db";
import { logger } from "./logger";
import { resolvePublicOrigins } from "./public-origin";

/**
 * BETTER_AUTH_SECRET signs session tokens. Without a stable value every
 * restart invalidates all sessions, so refuse to start rather than fail
 * confusingly later.
 */
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  throw new Error(
    "BETTER_AUTH_SECRET must be set. Generate one with: openssl rand -base64 32",
  );
}

const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
export const googleEnabled = Boolean(googleId && googleSecret);

if (!googleEnabled) {
  logger.warn("GOOGLE_CLIENT_ID/SECRET not set — Google sign-in is hidden; email sign-in still works");
}

const origins = resolvePublicOrigins();

/**
 * Logged at startup because every failure mode here looks like something else.
 * A wrong origin surfaces as a bare "forbidden" on sign-in, or as Google's
 * redirect_uri_mismatch, neither of which points at the cause. One line in the
 * boot log turns both into a five-second diagnosis.
 */
logger.info(
  { baseURL: origins.baseURL ?? "(derived per request)", source: origins.source, trustedOrigins: origins.trustedOrigins },
  "Resolved public origin",
);

export const auth = betterAuth({
  secret,
  baseURL: origins.baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: userTable,
      session: sessionTable,
      account: accountTable,
      verification: verificationTable,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // No mail provider is wired up yet, so requiring verification would lock
    // every new account out. Revisit before opening signup beyond the beta.
    requireEmailVerification: false,
  },
  socialProviders: googleEnabled
    ? { google: { clientId: googleId!, clientSecret: googleSecret! } }
    : {},
  // Empty means "derive from baseURL" — never "trust everything".
  trustedOrigins: origins.trustedOrigins.length ? origins.trustedOrigins : undefined,
  account: {
    accountLinking: {
      /**
       * Sign in with Google using an address that already has a password
       * account, and land in the same account rather than a new empty one.
       *
       * Without this the two are separate users, so someone who signed up with
       * a password in March and pressed "Continue with Google" in April would
       * find their diary apparently gone — the worst possible impression, and
       * indistinguishable from data loss.
       *
       * Only Google is trusted for this, because linking on a matching email
       * address is only safe when the provider actually verifies the address.
       * Trusting a provider that does not would let anyone claim an account by
       * signing up elsewhere with someone else's email.
       */
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  advanced: {
    // Replit terminates TLS at its proxy, so without this the server sees a
    // plain-http internal URL and builds an http:// callback that Google
    // rejects. Safe here because the proxy overwrites these headers on the way
    // in; they are a fallback for baseURL only, and never widen trustedOrigins.
    trustedProxyHeaders: true,
  },
});

/**
 * Give the first account every pre-auth row.
 *
 * All existing content was created before ownership existed, so it belongs to
 * whoever set the app up. Guarded on the user count being exactly 1: if a
 * second person somehow registered first, the orphans stay unclaimed and
 * invisible rather than being handed to a stranger. Losing sight of old test
 * data is recoverable; leaking a diary to the wrong account is not.
 */
export async function claimOrphanedRows(userId: string): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userTable);

  if (count !== 1) return;

  const claimed = await Promise.all([
    db.update(entriesTable).set({ userId }).where(isNull(entriesTable.userId)).returning({ id: entriesTable.id }),
    db.update(peopleTable).set({ userId }).where(isNull(peopleTable.userId)).returning({ id: peopleTable.id }),
    db.update(capturesTable).set({ userId }).where(isNull(capturesTable.userId)).returning({ id: capturesTable.id }),
  ]);

  const total = claimed.reduce((n, rows) => n + rows.length, 0);
  if (total > 0) {
    logger.info({ userId, entries: claimed[0].length, people: claimed[1].length, captures: claimed[2].length },
      "Claimed pre-auth rows for the first account");
  }
}

/** Resolve the signed-in user for a request, or null. */
export async function getSessionUser(headers: Headers): Promise<{ id: string } | null> {
  try {
    const session = await auth.api.getSession({ headers });
    return session?.user ? { id: session.user.id } : null;
  } catch (err) {
    logger.error({ err }, "Session lookup failed");
    return null;
  }
}

export { eq };
