import { pgTable, text, integer, date, primaryKey } from "drizzle-orm/pg-core";
import { userTable } from "./auth";

/**
 * Daily AI spend per user.
 *
 * Both providers bill per use, so the ceiling on a free account has to be
 * enforced somewhere durable. The previous limiter lived in process memory,
 * which fails twice over on Replit Autoscale: instances restart freely, and
 * more than one can run at a time — so the effective limit was
 * "whatever times however many instances happen to be up".
 *
 * One row per user per day. Old rows are cheap to keep and make it possible to
 * answer "what did last week actually cost" without a billing dashboard.
 */
export const aiUsageTable = pgTable(
  "ai_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),

    /** UTC day. A local-time day would give users near midnight a double allowance. */
    day: date("day").notNull(),

    /** Calls to any AI endpoint — the token-cost driver. */
    requests: integer("requests").notNull().default(0),

    /**
     * Audio sent for transcription. Whisper bills per minute, and duration
     * isn't knowable without decoding, so bytes stand in for it.
     */
    audioBytes: integer("audio_bytes").notNull().default(0),
  },
  table => [primaryKey({ columns: [table.userId, table.day] })],
);

export type AiUsage = typeof aiUsageTable.$inferSelect;
