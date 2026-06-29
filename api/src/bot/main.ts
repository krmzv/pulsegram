import { loadConfig } from "../config";
import { initDb } from "../db";
import { runMigrations } from "../db/migrate";
import { startBot, stopBot } from "./index";

async function main(): Promise<void> {
  loadConfig();
  await runMigrations();
  initDb();
  await startBot();

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, stopping bot…`);
    await stopBot().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("❌ Bot failed to start:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
