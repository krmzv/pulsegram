import { defineConfig } from "drizzle-kit";

// Used only for `drizzle-kit generate/studio` against the SQLite schema during
// development. Runtime schema bootstrap is handled by src/db/migrate.ts so the
// container needs no external migration step.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.sqlite.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/pulsegram.db",
  },
});
