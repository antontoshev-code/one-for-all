import { Router } from "express";
import {
  db, inArray, eq,
  entriesTable, peopleTable, entryPeopleTable, capturesTable, captureEntriesTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Both routes here are owner-scoped, and must stay that way.
 *
 * These are the two operations where an unscoped query is unrecoverable:
 * export would hand one person every other person's diary, and clear would
 * delete it. The junction tables carry no owner of their own, so they are
 * filtered through the ids of rows the caller actually owns rather than by a
 * column of their own.
 */

/** Ids of the caller's own entries and captures — the basis for junction filtering. */
async function ownedIds(userId: string) {
  const [entries, captures] = await Promise.all([
    db.select({ id: entriesTable.id }).from(entriesTable).where(eq(entriesTable.userId, userId)),
    db.select({ id: capturesTable.id }).from(capturesTable).where(eq(capturesTable.userId, userId)),
  ]);
  return {
    entryIds: entries.map(e => e.id),
    captureIds: captures.map(c => c.id),
  };
}

// GET /data/export — everything belonging to the signed-in user
router.get("/data/export", async (req, res) => {
  try {
    const { entryIds, captureIds } = await ownedIds(req.userId);

    const [entries, people, captures] = await Promise.all([
      db.select().from(entriesTable).where(eq(entriesTable.userId, req.userId)),
      db.select().from(peopleTable).where(eq(peopleTable.userId, req.userId)),
      db.select().from(capturesTable).where(eq(capturesTable.userId, req.userId)),
    ]);

    // inArray on an empty list is invalid SQL, so skip the query entirely.
    const links = entryIds.length
      ? await db.select().from(entryPeopleTable).where(inArray(entryPeopleTable.entryId, entryIds))
      : [];
    const captureLinks = captureIds.length
      ? await db.select().from(captureEntriesTable).where(inArray(captureEntriesTable.captureId, captureIds))
      : [];

    res.json({
      exportedAt: new Date().toISOString(),
      version: "1.2",
      counts: { entries: entries.length, people: people.length, captures: captures.length },
      entries,
      people,
      entryPeopleLinks: links,
      captures,
      captureEntryLinks: captureLinks,
    });
  } catch (err) {
    logger.error({ err }, "Data export failed");
    res.status(500).json({ error: "Export failed" });
  }
});

// POST /data/clear — delete everything belonging to the signed-in user
router.post("/data/clear", async (req, res) => {
  try {
    const { entryIds, captureIds } = await ownedIds(req.userId);

    // Junction rows first so nothing is left pointing at a deleted parent.
    if (entryIds.length) {
      await db.delete(entryPeopleTable).where(inArray(entryPeopleTable.entryId, entryIds));
    }
    if (captureIds.length) {
      await db.delete(captureEntriesTable).where(inArray(captureEntriesTable.captureId, captureIds));
    }

    await db.delete(entriesTable).where(eq(entriesTable.userId, req.userId));
    await db.delete(peopleTable).where(eq(peopleTable.userId, req.userId));
    await db.delete(capturesTable).where(eq(capturesTable.userId, req.userId));

    logger.info({ userId: req.userId }, "Cleared all data for user");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Clear all data failed");
    res.status(500).json({ error: "Failed to clear data" });
  }
});

export default router;
