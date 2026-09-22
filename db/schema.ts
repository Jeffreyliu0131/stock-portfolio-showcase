import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userPortfolios = sqliteTable("user_portfolios", {
  userId: text("user_id").primaryKey(),
  stateVersion: integer("state_version").notNull(),
  stateJson: text("state_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
