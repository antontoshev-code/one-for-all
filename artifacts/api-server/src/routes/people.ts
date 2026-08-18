import { Router, type IRouter } from "express";
import { eq, sql, inArray } from "drizzle-orm";
import { db, peopleTable, entriesTable, entryPeopleTable } from "@workspace/db";
import {
  CreatePersonBody,
  UpdatePersonBody,
  GetPersonParams,
  UpdatePersonParams,
  DeletePersonParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /people — list all
router.get("/people", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(peopleTable)
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
    .values({ name: parsed.data.name, notes: parsed.data.notes ?? null, descriptor: parsed.data.descriptor ?? null })
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
    .where(eq(peopleTable.id, params.data.id));

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
      .where(inArray(entriesTable.id, links.map((l) => l.entryId)))
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

  const updates: Partial<typeof peopleTable.$inferInsert> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.notes != null) updates.notes = parsed.data.notes;
  if (parsed.data.descriptor !== undefined) updates.descriptor = parsed.data.descriptor || null;

  const [person] = await db
    .update(peopleTable)
    .set(updates)
    .where(eq(peopleTable.id, params.data.id))
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

  await db.delete(peopleTable).where(eq(peopleTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
