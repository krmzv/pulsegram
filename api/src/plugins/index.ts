import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config";

export async function registerPlugins(app: FastifyInstance, cfg: Config): Promise<void> {
  // CORS locked to the configured base URL (the dashboard origin).
  await app.register(cors, {
    origin: cfg.isProd ? [cfg.baseUrl] : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });

  // Serve the built dashboard/status assets when present (production image).
  const publicDir = join(process.cwd(), "api", "public");
  const altPublicDir = join(process.cwd(), "public");
  const dir = existsSync(publicDir) ? publicDir : existsSync(altPublicDir) ? altPublicDir : null;
  if (dir) {
    await app.register(fastifyStatic, { root: dir, prefix: "/" });
  }
}
