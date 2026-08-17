import { pgTable, integer, primaryKey } from "drizzle-orm/pg-core";
import { entriesTable } from "./entries";
import { peopleTable } from "./people";

export const entryPeopleTable = pgTable("entry_people", {
  entryId: integer("entry_id").notNull().references(() => entriesTable.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.entryId, t.personId] })]);

export type EntryPerson = typeof entryPeopleTable.$inferSelect;
