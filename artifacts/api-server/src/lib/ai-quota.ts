/**
 * Free-tier ceiling on AI spend, per user per day.
 *
 * Split deliberately into arithmetic and storage. The arithmetic is where the
 * mistakes that cost money live — an off-by-one on the comparison, a day
 * boundary that rolls at the wrong moment — and it is the half that can be
 * tested without a database.
 */

/** UTC day key, e.g. "2026-08-19". Local time would hand users near midnight two allowances. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Whole hours until the allowance resets, floored at 1 so we never say "0 hours". */
export function hoursUntilReset(now: Date): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / (60 * 60 * 1000)));
}

export interface Limits {
  requests: number;
  audioBytes: number;
}

export interface Usage {
  requests: number;
  audioBytes: number;
}

export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: "requests" | "audio"; retryAfterHours: number; detail: string };

/**
 * Daily free-tier limits, with the cost reasoning written down so they can be
 * changed on purpose rather than by guess.
 *
 * Whisper bills about $0.006/minute and roughly 0.6MB of speech-bitrate audio
 * is a minute, so 6MB is ~10 minutes, ~$0.06. A Claude Haiku categorise/split
 * round trip is on the order of $0.004. So a user who exhausts both ceilings in
 * one day costs about $0.22.
 *
 * The sizing question was "100 people for 3 days": 300 user-days at the ceiling
 * is roughly $66, and that is the absolute worst case where every tester maxes
 * out every day. Real diary use runs far under it — 40 captures in a day is
 * already unusual — so the realistic figure is a small fraction of that.
 *
 * Both are overridable so the ceiling can be moved without a code change.
 */
export const FREE_LIMITS: Limits = {
  requests: Number(process.env.FREE_DAILY_AI_REQUESTS ?? 40),
  audioBytes: Number(process.env.FREE_DAILY_AUDIO_BYTES ?? 6 * 1024 * 1024),
};

/**
 * Decide whether one more call fits inside the day's allowance.
 *
 * Audio is checked against the size of the request being made, not just what
 * has already been spent: a single upload should not be able to step over the
 * ceiling just because it started under it.
 */
export function checkQuota(
  usage: Usage,
  limits: Limits,
  incomingAudioBytes: number,
  now: Date,
): QuotaVerdict {
  const retryAfterHours = hoursUntilReset(now);

  if (usage.requests >= limits.requests) {
    return {
      allowed: false,
      reason: "requests",
      retryAfterHours,
      detail: `You've used today's ${limits.requests} AI captures. Resets in about ${retryAfterHours} hour${retryAfterHours === 1 ? "" : "s"}. Captures still save — they just won't be organised automatically until then.`,
    };
  }

  if (incomingAudioBytes > 0 && usage.audioBytes + incomingAudioBytes > limits.audioBytes) {
    const minutes = Math.round(limits.audioBytes / (0.6 * 1024 * 1024));
    return {
      allowed: false,
      reason: "audio",
      retryAfterHours,
      detail: `You've used today's ${minutes} minutes of voice transcription. Resets in about ${retryAfterHours} hour${retryAfterHours === 1 ? "" : "s"}. You can still type, and recordings still save.`,
    };
  }

  return { allowed: true };
}
