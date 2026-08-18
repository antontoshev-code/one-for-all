import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { captureTypeEnum, entriesTable } from "./entries";

/**
 * Every original voice/text capture is recorded here so the user can
 * always trace back to exactly what they originally said, even after
 * splitting or reorganising.
 */
export const capturesTable = pgTable("captures", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  captureType: captureTypeEnum("capture_type").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Links a capture to the entries that were created from it.
 * entryId uses SET NULL on delete so history entries persist even if
 * the user later deletes individual entries.
 * categorySnapshot records what category the entry had at creation time.
 */
export const captureEntriesTable = pgTable("capture_entries", {
  id: serial("id").primaryKey(),
  captureId: integer("capture_id")
    .notNull()
    .references(() => capturesTable.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").references(() => entriesTable.id, {
    onDelete: "set null",
  }),
  categorySnapshot: text("category_snapshot").notNull(),
});

export type Capture = typeof capturesTable.$inferSelect;
export type CaptureEntry = typeof captureEntriesTable.$inferSelect;
