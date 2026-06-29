import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.toLowerCase() === "true" || v === "1"));

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required (get one from @BotFather)"),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().default("./data/pulsegram.db"),
  SELF_HOSTED: boolish(false),
  ALLOW_PRIVATE_TARGETS: boolish(false),
  BETTER_AUTH_SECRET: z.string().optional(),
  INTERNAL_SECRET: z.string().optional(),
  SCHEDULER_ENABLED: boolish(true),
  BOT_POLLING: boolish(true),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Dialect = "sqlite" | "postgres";

export interface Config {
  telegramBotToken: string;
  baseUrl: string;
  port: number;
  databaseUrl: string;
  dialect: Dialect;
  selfHosted: boolean;
  allowPrivateTargets: boolean;
  betterAuthSecret: string;
  internalSecret: string;
  schedulerEnabled: boolean;
  botPolling: boolean;
  isProd: boolean;
}

/** Where we persist the data volume (SQLite file + generated secret). */
function dataDir(databaseUrl: string, dialect: Dialect): string {
  if (dialect === "sqlite") {
    const p = isAbsolute(databaseUrl) ? databaseUrl : resolve(process.cwd(), databaseUrl);
    return dirname(p);
  }
  return resolve(process.cwd(), "data");
}

/**
 * Auto-generate BETTER_AUTH_SECRET and persist it to the data volume so
 * sessions survive restarts. Self-hosters never have to think about it.
 */
function ensureAuthSecret(provided: string | undefined, dir: string, filename = ".auth-secret"): string {
  if (provided && provided.length >= 16) return provided;
  const secretPath = join(dir, filename);
  if (existsSync(secretPath)) {
    const existing = readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 16) return existing;
  }
  const generated = randomBytes(32).toString("hex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  const env = parsed.data;
  const dialect: Dialect = env.DATABASE_URL.startsWith("postgres") ? "postgres" : "sqlite";
  const dir = dataDir(env.DATABASE_URL, dialect);
  if (dialect === "sqlite") mkdirSync(dir, { recursive: true });

  const internalSecret = ensureAuthSecret(env.INTERNAL_SECRET, dir, ".internal-secret");

  cached = {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    baseUrl: env.BASE_URL,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    dialect,
    selfHosted: env.SELF_HOSTED,
    allowPrivateTargets: env.ALLOW_PRIVATE_TARGETS,
    betterAuthSecret: ensureAuthSecret(env.BETTER_AUTH_SECRET, dir),
    internalSecret,
    schedulerEnabled: env.SCHEDULER_ENABLED,
    botPolling: env.BOT_POLLING,
    isProd: env.NODE_ENV === "production",
  };
  return cached;
}
