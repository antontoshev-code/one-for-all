import { pgTable, serial, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEntrySchema = createInsertSchema(entriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;
