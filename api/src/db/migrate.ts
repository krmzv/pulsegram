import { join } from "node:path";
import { loadConfig } from "../config";

const migrationsFolder = (dialect: "sqlite" | "pg") =>
  join(import.meta.dir, "../../drizzle", dialect);

export async function runMigrations(): Promise<void> {
  const cfg = loadConfig();

  if (cfg.dialect === "postgres") {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const sql = postgres(cfg.databaseUrl, { max: 1 });
    try {
      await migrate(drizzle(sql), { migrationsFolder: migrationsFolder("pg") });
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }

  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
  const sqlite = new Database(cfg.databaseUrl, { create: true });
  try {
    migrate(drizzle(sqlite), { migrationsFolder: migrationsFolder("sqlite") });
  } finally {
    sqlite.close();
  }
}

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
