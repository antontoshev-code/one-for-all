import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

/**
 * Spend guards for the AI endpoints.
 *
 * Both providers bill per use and nothing else in the app caps how much a
 * caller can spend: Whisper is priced per minute of audio and the Claude
 * calls per token. Without these limits a single stuck client — or one
 * person leaving a recording running — can run up an unbounded bill.
 */

/** Hard stop for all AI calls. Set AI_DISABLED=true to fall back to heuristics. */
export function aiDisabled(): boolean {
  return String(process.env.AI_DISABLED).toLowerCase() === "true";
}

/**
 * Whisper is billed per minute, so the real cost driver is audio duration.
 * Duration isn't knowable from an upload buffer without decoding it, so we
 * bound it by size instead: ~6MB of speech-bitrate webm/opus is roughly ten
 * minutes, which is far longer than a diary capture needs to be.
 */
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

/** Bounds the token cost of a single categorize/split/detect-names call. */
export const MAX_TEXT_CHARS = 20_000;

/**
 * Per-caller daily ceiling on AI requests.
 *
 * Keyed by IP because the app has no accounts yet — every visitor shares one
 * dataset, so there is no user id to key on. That makes this a blunt
 * instrument: people behind one NAT share a bucket, and a restart clears it.
 * It is a spend backstop, not a fair-usage system, and it should be replaced
 * with a per-user quota as soon as accounts exist.
 */
export const MAX_AI_REQUESTS_PER_DAY = 200;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Drop expired buckets so the map doesn't grow without bound. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function aiRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (aiDisabled()) {
    res.status(503).json({
      error: "AI processing is turned off",
      detail: "The app still works — captures fall back to keyword categorisation.",
    });
    return;
  }

  const now = Date.now();
  if (buckets.size > 1000) sweep(now);

  const key = req.ip ?? "unknown";
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + DAY_MS });
    next();
    return;
  }

  if (bucket.count >= MAX_AI_REQUESTS_PER_DAY) {
    const hoursLeft = Math.ceil((bucket.resetAt - now) / (60 * 60 * 1000));
    logger.warn({ key, count: bucket.count }, "AI daily limit reached");
    res.status(429).json({
      error: "Daily AI limit reached",
      detail: `Resets in about ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}. Captures still save — they just won't be AI-organised until then.`,
    });
    return;
  }

  bucket.count += 1;
  next();
}

/** Test seam — the limiter is process-memory only. */
export function __resetAiRateLimit(): void {
  buckets.clear();
}
