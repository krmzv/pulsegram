import { Database as BunDatabase } from "bun:sqlite";
import postgres from "postgres";
import { loadConfig } from "../config";

// Idempotent schema bootstrap. Runs on every boot so a fresh volume (or a
// fresh Postgres database) comes up ready with zero manual migration steps.
// DDL mirrors schema.sqlite.ts / schema.pg.ts.

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  email TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status_slug TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  name TEXT,
  method TEXT NOT NULL DEFAULT 'GET',
  interval_sec INTEGER NOT NULL DEFAULT 60,
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_check_at INTEGER,
  last_response_ms INTEGER,
  is_public INTEGER NOT NULL DEFAULT 1,
  is_paused INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cause TEXT
);
CREATE TABLE IF NOT EXISTS ssl_info (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  issuer TEXT,
  valid_from INTEGER,
  valid_to INTEGER,
  days_remaining INTEGER,
  checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at);
CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors(user_id);
`;

const PG_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  email TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status_slug TEXT UNIQUE,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  updated_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
);
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  name TEXT,
  method TEXT NOT NULL DEFAULT 'GET',
  interval_sec INTEGER NOT NULL DEFAULT 60,
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_check_at BIGINT,
  last_response_ms INTEGER,
  is_public INTEGER NOT NULL DEFAULT 1,
  is_paused INTEGER NOT NULL DEFAULT 0,
  muted_until BIGINT,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
  updated_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
);
CREATE TABLE IF NOT EXISTS heartbeats (
  id BIGSERIAL PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  message TEXT,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  cause TEXT
);
CREATE TABLE IF NOT EXISTS ssl_info (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  issuer TEXT,
  valid_from BIGINT,
  valid_to BIGINT,
  days_remaining INTEGER,
  checked_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at);
CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors(user_id);
`;

export async function runMigrations(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.dialect === "postgres") {
    const sql = postgres(cfg.databaseUrl, { max: 1 });
    try {
      await sql.unsafe(PG_DDL);
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  const sqlite = new BunDatabase(cfg.databaseUrl, { create: true });
  try {
    sqlite.exec("PRAGMA foreign_keys = ON;");
    sqlite.exec(SQLITE_DDL);
  } finally {
    sqlite.close();
  }
}

// Allow `bun run src/db/migrate.ts` standalone.
if (import.meta.main) {
  runMigrations()
    .then(() => {
      console.log("✅ migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ migration failed:", err);
      process.exit(1);
    });
}
