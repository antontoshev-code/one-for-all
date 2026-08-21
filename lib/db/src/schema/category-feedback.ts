import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { userTable } from "./auth";

/**
 * Times this user disagreed with the suggested category.
 *
 * "Утре по някое време трябва да сложа началото на деня си" was filed as a
 * task because it contains "трябва". It is a reflection about how someone wants
 * to wake up. No keyword list settles that, and no general instruction does
 * either — but this person's own corrections do, because what counts as a task
 * rather than a diary entry is partly a matter of how they think.
 *
 * Kept per user and fed back as examples. It is the same idea as the learned
 * vocabulary: the correction someone actually made is better evidence than any
 * rule written in advance.
 */
export const categoryFeedbackTable = pgTable(
  "category_feedback",
  {
    id: serial("id").primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),

    /**
     * The capture as it read. Truncated before storing — a few sentences is
     * enough to show the shape of the mistake, and this ends up inside a prompt
     * where length costs money.
     */
    text: text("text").notNull(),

    /** What the app proposed. */
    suggested: text("suggested").notNull(),

    /** What the person chose instead. */
    chosen: text("chosen").notNull(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  table => [index("category_feedback_user_idx").on(table.userId, table.createdAt)],
);

export type CategoryFeedback = typeof categoryFeedbackTable.$inferSelect;
