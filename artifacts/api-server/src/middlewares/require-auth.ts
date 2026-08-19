import type { Request, Response, NextFunction } from "express";
import { getSessionUser, claimOrphanedRows } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. Routes may read it without a null check. */
      userId: string;
    }
  }
}

/** Express headers → the WHATWG Headers object Better Auth expects. */
function toHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value != null) headers.append(key, value);
  }
  return headers;
}

/**
 * Rejects unauthenticated requests and pins `req.userId` for everything
 * downstream.
 *
 * Every content route sits behind this, so a missing WHERE clause can leak one
 * person's diary to another. Routes must filter on `req.userId` — this
 * middleware only establishes who is asking, it cannot enforce scoping for them.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getSessionUser(toHeaders(req));

  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  req.userId = user.id;

  // First account inherits the pre-auth rows. Cheap after the first run: it
  // short-circuits on a user count that isn't exactly 1.
  await claimOrphanedRows(user.id);

  next();
}
