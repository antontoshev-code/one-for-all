import { Router } from "express";
import { db, entriesTable, peopleTable, entryPeopleTable, capturesTable, captureEntriesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

// GET /data/export — full export of all user data (entries + people + history)
router.get("/data/export", async (_req, res) => {
  try {
    const [entries, people, links, captures, captureLinks] = await Promise.all([
      db.select().from(entriesTable),
      db.select().from(peopleTable),
      db.select().from(entryPeopleTable),
      db.select().from(capturesTable),
      db.select().from(captureEntriesTable),
    ]);

    res.json({
      exportedAt: new Date().toISOString(),
      version: "1.1",
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

// POST /data/clear — delete all data including history
router.post("/data/clear", async (_req, res) => {
  try {
    // Delete in dependency order: junction tables first, then leaf tables
    await db.delete(entryPeopleTable);
    await db.delete(captureEntriesTable);
    await db.delete(entriesTable);
    await db.delete(peopleTable);
    await db.delete(capturesTable);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Clear all data failed");
    res.status(500).json({ error: "Failed to clear data" });
  }
});

export default router;
