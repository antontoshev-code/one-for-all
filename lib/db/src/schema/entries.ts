import { pgTable, serial, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { userTable } from "./auth";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoryEnum = pgEnum("category", ["inbox", "journal", "task", "idea", "log"]);
export const captureTypeEnum = pgEnum("capture_type", ["voice", "text"]);

export const entriesTable = pgTable("entries", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  captureType: captureTypeEnum("capture_type").notNull().default("text"),
  category: categoryEnum("category").notNull().default("inbox"),
  isTaskDone: boolean("is_task_done").notNull().default(false),
  suggestedCategory: text("suggested_category"),

  /**
   * Owner. Nullable only so existing rows survive the migration — every row
   * written after auth landed has one. The first account created claims the
   * orphans (see claimOrphanedRows), after which nothing should be NULL.
   */
  userId: text("user_id").references(() => userTable.id, { onDelete: "cascade" }),

  /**
   * Set when the row is deleted, rather than removing it.
   *
   * A confirmation dialog is not a safety net — people confirm by reflex, and
   * the thing being deleted here is something they wrote about their own life.
   * Keeping the row lets Undo actually restore it instead of pretending to.
   *
   * Every read must exclude these. Use `notDeleted()` from @workspace/db rather
   * than writing the check by hand, so a missed one is a compile-time absence
   * rather than deleted entries quietly reappearing in a list.
   */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEntrySchema = createInsertSchema(entriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;
