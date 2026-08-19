import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, db, notDeleted, peopleTable, entriesTable, entryPeopleTable } from "@workspace/db";
import {
  CreatePersonBody,
  UpdatePersonBody,
  GetPersonParams,
  UpdatePersonParams,
  DeletePersonParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /people — list all
router.get("/people", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(peopleTable)
    .where(and(eq(peopleTable.userId, req.userId), notDeleted(peopleTable)))
    .orderBy(sql`${peopleTable.name} asc`);
  res.json(rows);
});

// POST /people — create
router.post("/people", async (req, res): Promise<void> => {
  const parsed = CreatePersonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [person] = await db
    .insert(peopleTable)
    .values({
      userId: req.userId,
      name: parsed.data.name,
      notes: parsed.data.notes ?? null,
      descriptor: parsed.data.descriptor ?? null,
      aliases: parsed.data.aliases ?? [],
      birthday: parsed.data.birthday ?? null,
      countryOfOrigin: parsed.data.countryOfOrigin ?? null,
      countryOfResidence: parsed.data.countryOfResidence ?? null,
      howWeMet: parsed.data.howWeMet ?? null,
    })
    .returning();

  res.status(201).json(person);
});

// GET /people/:id — detail with linked entries
router.get("/people/:id", async (req, res): Promise<void> => {
  const params = GetPersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [person] = await db
    .select()
    .from(peopleTable)
    .where(and(eq(peopleTable.id, params.data.id), eq(peopleTable.userId, req.userId), notDeleted(peopleTable)));

  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  const links = await db
    .select({ entryId: entryPeopleTable.entryId })
    .from(entryPeopleTable)
    .where(eq(entryPeopleTable.personId, params.data.id));

  let entries: typeof entriesTable.$inferSelect[] = [];
  if (links.length > 0) {
    entries = await db
      .select()
      .from(entriesTable)
      .where(and(
        inArray(entriesTable.id, links.map((l) => l.entryId)),
        eq(entriesTable.userId, req.userId),
        // A deleted entry must not reappear on a person's profile.
        notDeleted(entriesTable),
      ))
      .orderBy(sql`${entriesTable.createdAt} desc`);
  }

  res.json({ ...person, entries });
});

// PATCH /people/:id — update
router.patch("/people/:id", async (req, res): Promise<void> => {
  const params = UpdatePersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePersonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Text fields use `|| null` so clearing a field in the UI (which sends "")
  // stores NULL rather than an empty string. `aliases` is exempt: [] is a
  // meaningful value (no aliases) and must not collapse to NULL, since the
  // column is NOT NULL.
  const updates: Partial<typeof peopleTable.$inferInsert> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.notes != null) updates.notes = parsed.data.notes;
  if (parsed.data.descriptor !== undefined) updates.descriptor = parsed.data.descriptor || null;
  if (parsed.data.aliases !== undefined) {
    // Trim, drop blanks, and de-duplicate case-insensitively so repeated
    // confirmations of the same misspelling don't stack up.
    const seen = new Set<string>();
    updates.aliases = parsed.data.aliases
      .map((a) => a.trim())
      .filter((a) => {
        if (!a) return false;
        const key = a.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  if (parsed.data.birthday !== undefined) updates.birthday = parsed.data.birthday || null;
  if (parsed.data.countryOfOrigin !== undefined) updates.countryOfOrigin = parsed.data.countryOfOrigin || null;
  if (parsed.data.countryOfResidence !== undefined) updates.countryOfResidence = parsed.data.countryOfResidence || null;
  if (parsed.data.howWeMet !== undefined) updates.howWeMet = parsed.data.howWeMet || null;

  const [person] = await db
    .update(peopleTable)
    .set(updates)
    .where(and(eq(peopleTable.id, params.data.id), eq(peopleTable.userId, req.userId), notDeleted(peopleTable)))
    .returning();

  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  res.json(person);
});

// DELETE /people/:id
router.delete("/people/:id", async (req, res): Promise<void> => {
  const params = DeletePersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Soft delete, so Undo can restore them along with their links. The entries
  // that mention them are untouched either way — those are the user's words.
  await db
    .update(peopleTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(peopleTable.id, params.data.id), eq(peopleTable.userId, req.userId), notDeleted(peopleTable)));
  res.sendStatus(204);
});

// POST /people/:id/restore — undo a delete
router.post("/people/:id/restore", async (req, res): Promise<void> => {
  const params = DeletePersonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Not filtered by notDeleted — a deleted row is what this is for. Still
  // owner-scoped, so only your own deletion can be undone.
  const [restored] = await db
    .update(peopleTable)
    .set({ deletedAt: null })
    .where(and(eq(peopleTable.id, params.data.id), eq(peopleTable.userId, req.userId)))
    .returning({ id: peopleTable.id });

  if (!restored) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json(restored);
});

export default router;
