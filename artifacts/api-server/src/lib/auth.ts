import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  db, userTable, sessionTable, accountTable, verificationTable,
  entriesTable, peopleTable, capturesTable, isNull, eq, sql,
} from "@workspace/db";
import { logger } from "./logger";

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

export const auth = betterAuth({
  secret,
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
  trustedOrigins: process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : undefined,
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
