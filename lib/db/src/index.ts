import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

/**
 * Query helpers are re-exported so consumers never import `drizzle-orm`
 * directly.
 *
 * drizzle-orm declares ~30 optional peers (kysely, mysql2, better-sqlite3…).
 * pnpm keys a package instance on its resolved peer set, so a dependency that
 * happens to pull in one of those peers — better-auth pulls in kysely — makes
 * drizzle resolve twice. The two copies are the same version but TypeScript
 * treats their types as unrelated, producing errors like "separate declarations
 * of a private property 'shouldInlineParams'" in code nobody touched.
 *
 * Funnelling every consumer through this package keeps exactly one instance in
 * the type graph, whatever peers appear elsewhere in the tree.
 */
export {
  eq, ne, gt, gte, lt, lte,
  and, or, not,
  isNull, isNotNull,
  inArray, notInArray,
  like, ilike,
  asc, desc,
  sql,
} from "drizzle-orm";
