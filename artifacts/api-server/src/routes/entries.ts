import { Router, type IRouter } from "express";
import { eq, sql, inArray } from "drizzle-orm";
import { db, entriesTable, peopleTable, entryPeopleTable } from "@workspace/db";
import {
  CreateEntryBody,
  UpdateEntryBody,
  GetEntryParams,
  UpdateEntryParams,
  DeleteEntryParams,
  LinkPersonToEntryParams,
  LinkPersonToEntryBody,
  UnlinkPersonFromEntryParams,
  ListEntriesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Helper: fetch entry with its linked people
async function getEntryWithPeople(id: number) {
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!entry) return null;

  const links = await db
    .select({ personId: entryPeopleTable.personId })
    .from(entryPeopleTable)
    .where(eq(entryPeopleTable.entryId, id));

  let people: typeof peopleTable.$inferSelect[] = [];
  if (links.length > 0) {
    people = await db
      .select()
      .from(peopleTable)
      .where(inArray(peopleTable.id, links.map((l) => l.personId)));
  }

  return { ...entry, people };
}

// GET /entries — list, optionally filtered by category
router.get("/entries", async (req, res): Promise<void> => {
  const parsed = ListEntriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const rows = parsed.data.category
      ? await db
          .select()
          .from(entriesTable)
          .where(eq(entriesTable.category, parsed.data.category))
          .orderBy(sql`${entriesTable.createdAt} desc`)
      : await db
          .select()
          .from(entriesTable)
          .orderBy(sql`${entriesTable.createdAt} desc`);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to list entries", detail: String(err) });
  }
});

// POST /entries — create
router.post("/entries", async (req, res): Promise<void> => {
  const parsed = CreateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  try {
    const [entry] = await db
      .insert(entriesTable)
      .values({
        content: data.content,
        captureType: data.captureType,
        category: data.category ?? "inbox",
        suggestedCategory: data.suggestedCategory ?? null,
        sourceContent: data.sourceContent ?? null,
      })
      .returning();

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to create entry", detail: String(err) });
  }
});

// GET /entries/stats — per-category counts
router.get("/entries/stats", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({ category: entriesTable.category, count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .groupBy(entriesTable.category);

    const counts: Record<string, number> = { inbox: 0, journal: 0, task: 0, idea: 0, log: 0 };
    for (const row of rows) {
      counts[row.category] = row.count;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({ ...counts, total });
  } catch (err) {
    res.status(500).json({ error: "Failed to get stats", detail: String(err) });
  }
});

// GET /entries/:id — single entry with people
router.get("/entries/:id", async (req, res): Promise<void> => {
  const params = GetEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const entry = await getEntryWithPeople(params.data.id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to get entry", detail: String(err) });
  }
});

// PATCH /entries/:id — update (categorize, toggle done, edit text)
router.patch("/entries/:id", async (req, res): Promise<void> => {
  const params = UpdateEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof entriesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.content != null) updates.content = parsed.data.content;
  if (parsed.data.category != null) updates.category = parsed.data.category;
  if (parsed.data.isTaskDone != null) updates.isTaskDone = parsed.data.isTaskDone;
  if (parsed.data.suggestedCategory != null) updates.suggestedCategory = parsed.data.suggestedCategory;

  try {
    const [entry] = await db
      .update(entriesTable)
      .set(updates)
      .where(eq(entriesTable.id, params.data.id))
      .returning();

    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to update entry", detail: String(err) });
  }
});

// DELETE /entries/:id
router.delete("/entries/:id", async (req, res): Promise<void> => {
  const params = DeleteEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    await db.delete(entriesTable).where(eq(entriesTable.id, params.data.id));
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete entry", detail: String(err) });
  }
});

// POST /entries/:id/people — link person
router.post("/entries/:id/people", async (req, res): Promise<void> => {
  const params = LinkPersonToEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = LinkPersonToEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    await db
      .insert(entryPeopleTable)
      .values({ entryId: params.data.id, personId: parsed.data.personId })
      .onConflictDoNothing();

    const entry = await getEntryWithPeople(params.data.id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to link person", detail: String(err) });
  }
});

// DELETE /entries/:id/people/:personId — unlink person
router.delete("/entries/:id/people/:personId", async (req, res): Promise<void> => {
  const params = UnlinkPersonFromEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    await db
      .delete(entryPeopleTable)
      .where(
        sql`${entryPeopleTable.entryId} = ${params.data.id} AND ${entryPeopleTable.personId} = ${params.data.personId}`,
      );

    const entry = await getEntryWithPeople(params.data.id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to unlink person", detail: String(err) });
  }
});

export default router;
