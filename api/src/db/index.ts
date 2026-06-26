import { Database as BunDatabase } from "bun:sqlite";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "../config";
import { schema as sqliteSchema } from "./schema.sqlite";
import { schema as pgSchema } from "./schema.pg";

// SQLite schema is the canonical, statically-typed schema for the app. Column
// and table names are identical in the PG mirror, so the same query code runs
// against either driver; the PG database is cast to this type at init.
export type Schema = typeof sqliteSchema;
export type DB = BunSQLiteDatabase<Schema>;

interface DbHandle {
  db: DB;
  t: Schema;
  close: () => Promise<void>;
}

let handle: DbHandle | null = null;

export function initDb(): DbHandle {
  if (handle) return handle;
  const cfg = loadConfig();

  if (cfg.dialect === "postgres") {
    const sql = postgres(cfg.databaseUrl, { max: 10 });
    const db = drizzlePg(sql, { schema: pgSchema }) as unknown as DB;
    handle = {
      db,
      t: pgSchema as unknown as Schema,
      close: async () => {
        await sql.end({ timeout: 5 });
      },
    };
    return handle;
  }

  const sqlite = new BunDatabase(cfg.databaseUrl, { create: true });
  // WAL gives us good concurrent-read performance for the scheduler + bot.
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  const db = drizzleBun(sqlite, { schema: sqliteSchema });
  handle = {
    db,
    t: sqliteSchema,
    close: async () => {
      sqlite.close();
    },
  };
  return handle;
}

/** Convenience accessors (call initDb() once at boot first). */
export function getDb(): DbHandle {
  if (!handle) return initDb();
  return handle;
}
