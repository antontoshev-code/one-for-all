import type { Request, Response, NextFunction } from "express";
import { db, aiUsageTable, and, eq, sql } from "@workspace/db";
import { logger } from "./logger";
import { FREE_LIMITS, checkQuota, utcDay } from "./ai-quota";

/**
 * Spend guards for the AI endpoints.
 *
 * Both providers bill per use and nothing else in the app caps how much a
 * caller can spend: Whisper is priced per minute of audio and the Claude calls
 * per token. Without these limits one stuck client — or one person leaving a
 * recording running — runs up an unbounded bill.
 */

/** Hard stop for all AI calls. Set AI_DISABLED=true to fall back to heuristics. */
export function aiDisabled(): boolean {
  return String(process.env.AI_DISABLED).toLowerCase() === "true";
}

/**
 * Whisper is billed per minute, so the real cost driver is audio duration.
 * Duration isn't knowable from an upload buffer without decoding it, so we
 * bound it by size instead: ~6MB of speech-bitrate webm/opus is roughly ten
 * minutes, far longer than a diary capture needs to be. This caps a single
 * request; the daily ceiling is enforced separately below.
 */
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

/** Bounds the token cost of a single categorize/split/detect-names call. */
export const MAX_TEXT_CHARS = 20_000;

/**
 * Charge one AI call against the user's day, atomically.
 *
 * The increment and the limit check are one statement on purpose. Read-then-write
 * loses to itself: the app fires transcribe, split, categorise and detect-names
 * in quick succession, so concurrent requests would each read the same
 * pre-increment count and all decide they fit.
 *
 * Postgres applies the WHERE to the conflict branch, so when the user is over
 * their allowance no row is updated and nothing is returned — the call is
 * refused without inflating the number it was refused for.
 */
async function charge(userId: string, audioBytes: number): Promise<boolean> {
  const rows = await db
    .insert(aiUsageTable)
    .values({ userId, day: utcDay(new Date()), requests: 1, audioBytes })
    .onConflictDoUpdate({
      target: [aiUsageTable.userId, aiUsageTable.day],
      set: {
        requests: sql`${aiUsageTable.requests} + 1`,
        audioBytes: sql`${aiUsageTable.audioBytes} + ${audioBytes}`,
      },
      setWhere: and(
        sql`${aiUsageTable.requests} < ${FREE_LIMITS.requests}`,
        sql`${aiUsageTable.audioBytes} + ${audioBytes} <= ${FREE_LIMITS.audioBytes}`,
      ),
    })
    .returning({ requests: aiUsageTable.requests });

  return rows.length > 0;
}

/** Read the day's usage. Only needed on the refusal path, to say which limit was hit. */
async function usageToday(userId: string) {
  const [row] = await db
    .select({ requests: aiUsageTable.requests, audioBytes: aiUsageTable.audioBytes })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, utcDay(new Date()))));

  return row ?? { requests: 0, audioBytes: 0 };
}

/**
 * Enforce the daily free-tier allowance for the signed-in user.
 *
 * Must be mounted after requireAuth, and — on the transcribe route — after
 * multer, so the size of the upload being charged for is known.
 */
export function aiQuota(req: Request, res: Response, next: NextFunction): void {
  if (aiDisabled()) {
    res.status(503).json({
      error: "AI processing is turned off",
      detail: "The app still works — captures fall back to keyword categorisation.",
    });
    return;
  }

  const audioBytes = req.file?.size ?? 0;

  // A single upload larger than the whole daily allowance would sail past the
  // conflict guard on the first call of the day, when there is no row to
  // conflict with. Catch it before it reaches the database.
  if (audioBytes > FREE_LIMITS.audioBytes) {
    const verdict = checkQuota({ requests: 0, audioBytes: 0 }, FREE_LIMITS, audioBytes, new Date());
    res.status(429).json({
      error: "Daily voice limit reached",
      detail: verdict.allowed ? "That recording is too long." : verdict.detail,
    });
    return;
  }

  void charge(req.userId, audioBytes)
    .then(async allowed => {
      if (allowed) {
        next();
        return;
      }

      const verdict = checkQuota(await usageToday(req.userId), FREE_LIMITS, audioBytes, new Date());
      logger.warn({ userId: req.userId, reason: verdict.allowed ? "unknown" : verdict.reason },
        "AI daily limit reached");

      res.status(429).json({
        error: verdict.allowed === false && verdict.reason === "audio"
          ? "Daily voice limit reached"
          : "Daily AI limit reached",
        detail: verdict.allowed ? "Daily limit reached." : verdict.detail,
      });
    })
    .catch(err => {
      // Fail open. A metering outage should not stop someone recording their
      // day; the per-request size and length caps still bound the damage.
      logger.error({ err }, "AI quota check failed — allowing the request");
      next();
    });
}
