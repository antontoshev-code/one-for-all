import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, capturesTable, captureEntriesTable, entriesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /captures — full history, newest first ─────────────────────────────

router.get("/captures", async (_req, res): Promise<void> => {
  try {
    const captures = await db
      .select()
      .from(capturesTable)
      .orderBy(sql`${capturesTable.createdAt} desc`);

    const result = await Promise.all(
      captures.map(async (capture) => {
        const links = await db
          .select()
          .from(captureEntriesTable)
          .where(eq(captureEntriesTable.captureId, capture.id));

        const entries = await Promise.all(
          links.map(async (link) => {
            if (link.entryId === null) {
              return {
                entryId: null,
                category: link.categorySnapshot,
                content: null,
                exists: false,
              };
            }
            const [entry] = await db
              .select()
              .from(entriesTable)
              .where(eq(entriesTable.id, link.entryId));
            return {
              entryId: link.entryId,
              category: link.categorySnapshot,
              content: entry?.content ?? null,
              exists: !!entry,
            };
          }),
        );

        return { ...capture, entries };
      }),
    );

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to list captures");
    res.status(500).json({ error: "Failed to list captures" });
  }
});

// ── POST /captures — record a capture + its resulting entries ──────────────

router.post("/captures", async (req, res): Promise<void> => {
  const { content, captureType, entries } = req.body as {
    content?: string;
    captureType?: string;
    entries?: { entryId: number; category: string }[];
  };

  if (
    !content?.trim() ||
    !captureType ||
    !Array.isArray(entries) ||
    entries.length === 0
  ) {
    res.status(400).json({ error: "content, captureType, and entries[] are required" });
    return;
  }

  try {
    const [capture] = await db
      .insert(capturesTable)
      .values({
        content: content.trim(),
        captureType: captureType as "voice" | "text",
      })
      .returning();

    await db.insert(captureEntriesTable).values(
      entries.map((e) => ({
        captureId: capture.id,
        entryId: e.entryId ?? null,
        categorySnapshot: e.category,
      })),
    );

    res.status(201).json({ id: capture.id });
  } catch (err) {
    logger.error({ err }, "Failed to create capture");
    res.status(500).json({ error: "Failed to create capture" });
  }
});

export default router;
