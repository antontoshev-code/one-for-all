import { Router, type IRouter } from "express";
import { eq, sql, inArray, and, or, isNull, notDeleted, db, entriesTable, peopleTable, entryPeopleTable } from "@workspace/db";
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

// ── Server-side dedup guard ───────────────────────────────────────────────
// Single-user app: reject identical content submitted within 500 ms.
// Protects against network retries and client-side bugs slipping through.
const recentSubmissions = new Map<string, number>(); // content key → epoch ms

function isDuplicate(content: string): boolean {
  const key = content.trim();
  const now = Date.now();
  const last = recentSubmissions.get(key);
  if (last !== undefined && now - last < 500) return true;
  recentSubmissions.set(key, now);
  // Auto-evict after 1 s so the map never grows
  setTimeout(() => recentSubmissions.delete(key), 1000);
  return false;
}

// Helper: fetch entry with its linked people
async function getEntryWithPeople(id: number, userId: string) {
  const [entry] = await db
    .select()
    .from(entriesTable)
    .where(and(eq(entriesTable.id, id), eq(entriesTable.userId, userId), notDeleted(entriesTable)));
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
      .where(and(
        inArray(peopleTable.id, links.map((l) => l.personId)),
        eq(peopleTable.userId, userId),
        // The junction row survives a person's deletion, so without this a
        // deleted person keeps appearing attached to every entry they touched.
        notDeleted(peopleTable),
      ));
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
          .where(and(
            eq(entriesTable.category, parsed.data.category),
            eq(entriesTable.userId, req.userId), notDeleted(entriesTable),
          ))
          .orderBy(sql`${entriesTable.createdAt} desc`)
      : await db
          .select()
          .from(entriesTable)
          .where(and(eq(entriesTable.userId, req.userId), notDeleted(entriesTable)))
          .orderBy(sql`${entriesTable.createdAt} desc`);

    /**
     * The people each entry mentions, attached to the list.
     *
     * A person's profile showed the entries about them, but the entries never
     * showed the people — so reading back a journal gave no sign that it was
     * about anyone, and the link was only visible from one side.
     *
     * Fetched in one query for the whole page rather than one per entry: a
     * hundred journal entries would otherwise be a hundred round trips.
     */
    const ids = rows.map(r => r.id);
    const links = ids.length
      ? await db
          .select({
            entryId: entryPeopleTable.entryId,
            id: peopleTable.id,
            name: peopleTable.name,
            descriptor: peopleTable.descriptor,
          })
          .from(entryPeopleTable)
          .innerJoin(peopleTable, eq(entryPeopleTable.personId, peopleTable.id))
          .where(and(inArray(entryPeopleTable.entryId, ids), notDeleted(peopleTable)))
      : [];

    const byEntry = new Map<number, { id: number; name: string; descriptor: string | null }[]>();
    for (const link of links) {
      const list = byEntry.get(link.entryId) ?? [];
      list.push({ id: link.id, name: link.name, descriptor: link.descriptor });
      byEntry.set(link.entryId, list);
    }

    res.json(rows.map(row => ({ ...row, people: byEntry.get(row.id) ?? [] })));
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

  if (isDuplicate(data.content)) {
    res.status(409).json({ error: "Duplicate submission — identical content received within 500 ms" });
    return;
  }

  try {
    const [entry] = await db
      .insert(entriesTable)
      .values({
        userId: req.userId,
        content: data.content,
        captureType: data.captureType,
        category: data.category ?? "inbox",
        suggestedCategory: data.suggestedCategory ?? null,
      })
      .returning();

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to create entry", detail: String(err) });
  }
});

// GET /entries/stats — per-category counts
// Task count = open tasks only (isTaskDone false/null) so Home badge hits 0 when all tasks are done.
router.get("/entries/stats", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({ category: entriesTable.category, count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(and(eq(entriesTable.userId, req.userId), notDeleted(entriesTable)))
      .groupBy(entriesTable.category);

    const counts: Record<string, number> = { inbox: 0, journal: 0, task: 0, idea: 0, log: 0 };
    for (const row of rows) {
      counts[row.category] = row.count;
    }

    // Override task count with open-only (isTaskDone = false or null)
    const [openTaskRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(and(
        eq(entriesTable.userId, req.userId), notDeleted(entriesTable),
        eq(entriesTable.category, "task"),
        or(eq(entriesTable.isTaskDone, false), isNull(entriesTable.isTaskDone)),
      ));
    counts["task"] = openTaskRow?.count ?? 0;

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
    const entry = await getEntryWithPeople(params.data.id, req.userId);
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
      .where(and(eq(entriesTable.id, params.data.id), eq(entriesTable.userId, req.userId), notDeleted(entriesTable)))
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
    // Soft delete. The row stays so Undo can bring it back — a confirmation
    // dialog is not a safety net when people confirm by reflex, and what is
    // being deleted is something they wrote about their own life.
    await db
      .update(entriesTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(entriesTable.id, params.data.id), eq(entriesTable.userId, req.userId), notDeleted(entriesTable)));
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete entry", detail: String(err) });
  }
});

/**
 * PATCH /entries/:id/due — set or clear a task's due time.
 *
 * A route of its own rather than a field on the entry update, because the entry
 * schemas are generated from the OpenAPI spec and regenerating that client has
 * broken this build before. This is the smaller, reversible change.
 */
router.patch("/entries/:id/due", async (req, res): Promise<void> => {
  const params = UpdateEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { dueAt } = req.body as { dueAt?: string | null };

  // null clears it; anything else has to be a real timestamp. A string that
  // does not parse would become an Invalid Date and then a null column, which
  // looks like a successful clear rather than the rejected input it is.
  if (dueAt !== null && (typeof dueAt !== "string" || Number.isNaN(Date.parse(dueAt)))) {
    res.status(400).json({ error: "dueAt must be an ISO timestamp or null" });
    return;
  }

  try {
    const [updated] = await db
      .update(entriesTable)
      .set({ dueAt: dueAt === null ? null : new Date(dueAt) })
      .where(and(
        eq(entriesTable.id, params.data.id),
        eq(entriesTable.userId, req.userId),
        notDeleted(entriesTable),
      ))
      .returning({ id: entriesTable.id, dueAt: entriesTable.dueAt });

    if (!updated) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to set the due time", detail: String(err) });
  }
});

// POST /entries/:id/restore — undo a delete
router.post("/entries/:id/restore", async (req, res): Promise<void> => {
  const params = DeleteEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    // Deliberately not filtered by notDeleted: a deleted row is exactly what
    // this is looking for. Still owner-scoped, so it can only ever restore
    // something the caller deleted themselves.
    const [restored] = await db
      .update(entriesTable)
      .set({ deletedAt: null })
      .where(and(eq(entriesTable.id, params.data.id), eq(entriesTable.userId, req.userId)))
      .returning({ id: entriesTable.id });

    if (!restored) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(restored);
  } catch (err) {
    res.status(500).json({ error: "Failed to restore entry", detail: String(err) });
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
    const [ownedEntry] = await db
      .select({ id: entriesTable.id })
      .from(entriesTable)
      .where(and(eq(entriesTable.id, params.data.id), eq(entriesTable.userId, req.userId), notDeleted(entriesTable)));
    const [ownedPerson] = await db
      .select({ id: peopleTable.id })
      .from(peopleTable)
      .where(and(
        eq(peopleTable.id, parsed.data.personId),
        eq(peopleTable.userId, req.userId),
        notDeleted(peopleTable),
      ));

    if (!ownedEntry || !ownedPerson) {
      res.status(404).json({ error: "Entry or person not found" });
      return;
    }

    await db
      .insert(entryPeopleTable)
      .values({ entryId: params.data.id, personId: parsed.data.personId })
      .onConflictDoNothing();

    const entry = await getEntryWithPeople(params.data.id, req.userId);
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

    const entry = await getEntryWithPeople(params.data.id, req.userId);
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
