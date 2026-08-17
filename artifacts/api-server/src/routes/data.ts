import { Router } from "express";
import { db, entriesTable, peopleTable, entryPeopleTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

// GET /data/export — full export of all user data
router.get("/data/export", async (_req, res) => {
  try {
    const [entries, people, links] = await Promise.all([
      db.select().from(entriesTable),
      db.select().from(peopleTable),
      db.select().from(entryPeopleTable),
    ]);

    res.json({
      exportedAt: new Date().toISOString(),
      version: "1.0",
      counts: { entries: entries.length, people: people.length },
      entries,
      people,
      entryPeopleLinks: links,
    });
  } catch (err) {
    logger.error({ err }, "Data export failed");
    res.status(500).json({ error: "Export failed" });
  }
});

// POST /data/clear — delete all data (junction table first to avoid FK violations)
router.post("/data/clear", async (_req, res) => {
  try {
    await db.delete(entryPeopleTable);
    await db.delete(entriesTable);
    await db.delete(peopleTable);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Clear all data failed");
    res.status(500).json({ error: "Failed to clear data" });
  }
});

export default router;
