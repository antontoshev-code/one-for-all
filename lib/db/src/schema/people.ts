import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const peopleTable = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  descriptor: text("descriptor"),  // optional short label: "Studentina", "climbing gym", "WWF"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPersonSchema = createInsertSchema(peopleTable).omit({ id: true, createdAt: true });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof peopleTable.$inferSelect;
