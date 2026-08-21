import { Router } from "express";
import { db, eq, and, sql, vocabularyTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { learnFromEdit } from "../lib/learn-words";

const router = Router();

/** Guards against a runaway list — and against one capture teaching fifty words. */
const MAX_WORDS_PER_USER = 500;
const MAX_LEARNED_PER_EDIT = 10;

/**
 * POST /vocabulary/learn — remember the words this user corrected by hand.
 *
 * Called when a capture is saved after being edited. The edit is the most
 * reliable signal available about what was actually said: not a guess, not a
 * model's confidence, but the person who was there telling us.
 */
router.post("/vocabulary/learn", async (req, res) => {
  const { original, edited } = req.body as { original?: string; edited?: string };

  if (typeof original !== "string" || typeof edited !== "string") {
    res.status(400).json({ error: "original and edited must be strings" });
    return;
  }

  try {
    const learned = learnFromEdit(original, edited).slice(0, MAX_LEARNED_PER_EDIT);
    if (learned.length === 0) {
      res.json({ learned: 0 });
      return;
    }

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vocabularyTable)
      .where(eq(vocabularyTable.userId, req.userId));

    if (count >= MAX_WORDS_PER_USER) {
      logger.info({ userId: req.userId }, "Vocabulary full — not learning further words");
      res.json({ learned: 0, reason: "full" });
      return;
    }

    await db
      .insert(vocabularyTable)
      .values(learned.map(l => ({
        userId: req.userId,
        word: l.to,
        kind: "use" as const,
        source: "learned" as const,
      })))
      // Learning the same fix twice is one lesson, not a failure.
      .onConflictDoNothing();

    // Count only — these words come from the user's captures, and the privacy
    // page says server logs never record what they wrote.
    logger.info({ userId: req.userId, count: learned.length }, "Learned words from an edit");
    res.json({ learned: learned.length });
  } catch (err) {
    // Learning is an improvement, never a requirement. A failure here must not
    // surface to someone who was only trying to save a diary entry.
    logger.error({ err }, "Failed to learn vocabulary");
    res.json({ learned: 0 });
  }
});

/**
 * POST /vocabulary — add a word by hand.
 *
 * Separate from /learn on purpose. Learning infers a correction from an edit
 * and applies rules about what counts as a repair — the first letter must
 * match, the words must be close. A word typed here is not an inference; the
 * user is stating it, and putting it through the repair rules would reject
 * exactly the words they most want to add.
 */
router.post("/vocabulary", async (req, res) => {
  const { word } = req.body as { word?: string };
  const trimmed = typeof word === "string" ? word.trim() : "";

  if (!trimmed) {
    res.status(400).json({ error: "word must be a non-empty string" });
    return;
  }

  // Long enough to be a word, short enough not to be a sentence pasted in.
  if (trimmed.length < 2 || trimmed.length > 60 || /\s{2,}/.test(trimmed)) {
    res.status(400).json({ error: "word must be between 2 and 60 characters" });
    return;
  }

  try {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vocabularyTable)
      .where(eq(vocabularyTable.userId, req.userId));

    if (count >= MAX_WORDS_PER_USER) {
      res.status(409).json({ error: "Your word list is full", detail: "Remove a word first." });
      return;
    }

    const [added] = await db
      .insert(vocabularyTable)
      .values({ userId: req.userId, word: trimmed, kind: "use", source: "manual" })
      .onConflictDoNothing()
      .returning({ id: vocabularyTable.id, word: vocabularyTable.word });

    // Nothing returned means it was already there, which is a success from the
    // user's point of view — the word is in the list either way.
    res.json(added ?? { word: trimmed, alreadyPresent: true });
  } catch (err) {
    logger.error({ err }, "Failed to add a vocabulary word");
    res.status(500).json({ error: "Failed to add the word" });
  }
});

/**
 * POST /vocabulary/keep — stop correcting a word the user put back.
 *
 * Undoing a suggested correction says the original was right. Without recording
 * that, the app would make the same wrong correction on every capture and the
 * user would have no way to stop it.
 */
router.post("/vocabulary/keep", async (req, res) => {
  const { word } = req.body as { word?: string };

  if (typeof word !== "string" || !word.trim()) {
    res.status(400).json({ error: "word must be a non-empty string" });
    return;
  }

  try {
    await db
      .insert(vocabularyTable)
      .values({ userId: req.userId, word: word.trim(), kind: "keep", source: "manual" })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to record a kept word");
    res.json({ ok: false });
  }
});

/** GET /vocabulary — the user's own list, so it can be reviewed and pruned. */
router.get("/vocabulary", async (req, res) => {
  try {
    const words = await db
      .select({
        id: vocabularyTable.id,
        word: vocabularyTable.word,
        kind: vocabularyTable.kind,
        source: vocabularyTable.source,
      })
      .from(vocabularyTable)
      .where(eq(vocabularyTable.userId, req.userId));
    res.json(words);
  } catch (err) {
    logger.error({ err }, "Failed to list vocabulary");
    res.status(500).json({ error: "Failed to load vocabulary" });
  }
});

/** DELETE /vocabulary/:id — remove a word that was learned wrongly. */
router.delete("/vocabulary/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }

  try {
    await db
      .delete(vocabularyTable)
      .where(and(eq(vocabularyTable.id, id), eq(vocabularyTable.userId, req.userId)));
    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "Failed to delete a vocabulary word");
    res.status(500).json({ error: "Failed to delete word" });
  }
});

export default router;
