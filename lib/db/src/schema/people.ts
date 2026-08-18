import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { userTable } from "./auth";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const peopleTable = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  descriptor: text("descriptor"),  // optional short label: "Studentina", "climbing gym", "WWF"

  // Alternate spellings this person is known by. Speech-to-text spells names
  // inconsistently ("Petja" for "Petya") and users write in more than one
  // script (Петя / Petya), so mention-matching checks name + aliases.
  aliases: text("aliases").array().notNull().default([]),

  // Stored as a plain string rather than a date column: a birthday is often
  // known only partially ("October"), and a date column can't hold that.
  birthday: text("birthday"),

  countryOfOrigin: text("country_of_origin"),
  // Left blank when the person still lives where they're from.
  countryOfResidence: text("country_of_residence"),

  howWeMet: text("how_we_met"),


  /**
   * Owner. Nullable only so existing rows survive the migration — every row
   * written after auth landed has one. The first account created claims the
   * orphans (see claimOrphanedRows), after which nothing should be NULL.
   */
  userId: text("user_id").references(() => userTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPersonSchema = createInsertSchema(peopleTable).omit({ id: true, createdAt: true });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof peopleTable.$inferSelect;
