import { pgTable, serial, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { userTable } from "./auth";

/**
 * Words this user is known to use, and words they never want corrected.
 *
 * Transcription mangles proper nouns, and no general model can know that this
 * particular person says "тараторче" or has a friend called Дани. The curated
 * lists cover places and products; this covers the half that is different for
 * everybody.
 *
 * Strictly per-user. A shared pool built from corrections would carry names out
 * of one person's private life into another's transcription, which is the one
 * thing this app promises not to do — so there is no path from one user's rows
 * to another's, by construction rather than by policy.
 */
export const vocabularyTable = pgTable(
  "vocabulary",
  {
    id: serial("id").primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),

    /** The word in its correct form. */
    word: text("word").notNull(),

    /**
     * `use` — a word to bias transcription toward and correct towards.
     * `keep` — a word to leave alone, recorded when someone undoes a correction
     * the app suggested. Without it the app would make the same wrong
     * correction on every capture and the user would have no way to stop it.
     */
    kind: text("kind").notNull().default("use"),

    /**
     * How it got here: `learned` from an edit, `manual` from the user typing it.
     * Kept so a list that has picked up something odd can be understood rather
     * than just cleared.
     */
    source: text("source").notNull().default("learned"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  table => [
    // The same word learned twice is one entry, and lookups are always by user.
    unique("vocabulary_user_word_kind").on(table.userId, table.word, table.kind),
    index("vocabulary_user_idx").on(table.userId),
  ],
);

export type VocabularyWord = typeof vocabularyTable.$inferSelect;
