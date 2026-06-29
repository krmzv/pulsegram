import Fastify from "fastify";
import { loadConfig } from "./config";
import { initDb } from "./db";
import { runMigrations } from "./db/migrate";
import { registerPlugins } from "./plugins";
import { registerInternalRoutes } from "./routes/internal";
import { startBot, stopBot } from "./bot";
import { getBot } from "./bot/bot";
import { startScheduler, stopScheduler } from "./scheduler/scheduler";

async function main(): Promise<void> {
  // 1. Validate config + ensure auth secret (throws with a clear message if bad).
  const cfg = loadConfig();

  // 2. Bring the schema up to date (idempotent), then open the pooled handle.
  await runMigrations();
  initDb();

  // 3. HTTP server.
  const app = Fastify({
    logger: { level: cfg.isProd ? "info" : "warn" },
    disableRequestLogging: cfg.isProd,
  });
  await registerPlugins(app, cfg);
  await registerInternalRoutes(app);

  app.get("/healthz", async () => ({ status: "ok", selfHosted: cfg.selfHosted }));

  // 4. Background workers.
  if (cfg.schedulerEnabled) startScheduler();
  if (cfg.botPolling) {
    await startBot();
  } else {
    getBot(); // initialize so notifyDown/notifyRecovery can call getBot().api.sendMessage
  }

  // 5. Listen (0.0.0.0 so it's reachable from outside the container).
  await app.listen({ port: cfg.port, host: "0.0.0.0" });
  console.log(`🚀 Pulsegram API listening on :${cfg.port} (${cfg.dialect})`);

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down…`);
    if (cfg.schedulerEnabled) stopScheduler();
    if (cfg.botPolling) await stopBot().catch(() => {});
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("❌ Failed to start Pulsegram:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
