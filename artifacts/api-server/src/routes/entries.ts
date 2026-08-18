import { Router, type IRouter } from "express";
import { eq, sql, inArray, and, or, isNull } from "drizzle-orm";
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
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Keyword heuristic — used as a fallback when LLM is unavailable or fails
// ---------------------------------------------------------------------------
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
  const parsed = LinkPersonToEntryBody.safeParse(req.body);

      const validCategories = ["journal", "task", "idea", "log"] as const;
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const rows = await db
      .select({ category: entriesTable.category, count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .groupBy(entriesTable.category);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to list entries", detail: String(err) });
  }
});

// POST /entries — create
router.post("/entries", async (req, res): Promise<void> => {
  const parsed = LinkPersonToEntryBody.safeParse(req.body);

      const validCategories = ["journal", "task", "idea", "log"] as const;
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
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, params.data.id));

  let category: "journal" | "task" | "idea" | "log";

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to create entry", detail: String(err) });
  }
});

// GET /entries/stats — per-category counts
// Task count = open tasks only (isTaskDone false/null) so Home badge hits 0 when all tasks are done.
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

    // Override task count with open-only (isTaskDone = false or null)
    const [openTaskRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entriesTable)
      .where(and(
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

  const parsed = LinkPersonToEntryBody.safeParse(req.body);

      const validCategories = ["journal", "task", "idea", "log"] as const;
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
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, params.data.id));

  let category: "journal" | "task" | "idea" | "log";

    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to update entry", detail: String(err) });
  }
});

// POST /entries/:id/suggest-category — LLM-based categorization with heuristic fallback
router.post("/entries/:id/suggest-category", async (req, res): Promise<void> => {
  const params = UnlinkPersonFromEntryParams.safeParse(req.params);
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
  const params = UnlinkPersonFromEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = LinkPersonToEntryBody.safeParse(req.body);

      const validCategories = ["journal", "task", "idea", "log"] as const;
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

function heuristicCategorize(text: string): "journal" | "task" | "idea" | "log" {
  const t = text.toLowerCase();
  const taskWords = ["need to", "remind", "todo", "must", "should", "don't forget", "remember to", "have to", "call", "email", "schedule"];
  if (taskWords.some((w) => t.includes(w))) return "task";
  const ideaWords = ["idea", "what if", "concept", "maybe we could", "what about", "thinking about building", "could be interesting"];
  if (ideaWords.some((w) => t.includes(w))) return "idea";
  const logWords = ["did", "went", "finished", "completed", "ran", "worked out", "workout", "ate", "cooked", "watched", "read"];
  if (logWords.some((w) => t.includes(w))) return "log";
  return "journal";
}

  let reason: string;

  let usedAI = false;

function getOpenAIClient(): OpenAI | null {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

      const text = response.choices[0]?.message?.content ?? "";

  const client = getOpenAIClient();

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content: `You are a personal note categorizer. Given a note, classify it into exactly one of these categories:
- task: action items, todos, reminders, things still to be done
- idea: creative thoughts, brainstorming, concepts, "what if" thoughts
- log: past events, activities already completed, things that happened
- journal: personal reflections, feelings, observations, general thoughts

Respond with JSON only, no markdown: {"category": "<journal|task|idea|log>", "reason": "<10 words max explaining why>"}`,
          },
          {
            role: "user",
            content: entry.content,
          },
        ],
      });
