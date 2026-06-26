import { sql } from "drizzle-orm";
import { bigint, bigserial, index, integer, pgTable, text } from "drizzle-orm/pg-core";

// Mirror of schema.sqlite.ts for the postgres:// driver. Column names and
// semantics match exactly (epoch-seconds stored as bigint) so the same query
// code runs against either dialect.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const nowEpoch = sql`extract(epoch from now())::bigint`;

export const users = pgTable("users", {
  id: id(),
  telegramId: text("telegram_id").unique(),
  email: text("email").unique(),
  plan: text("plan").notNull().default("free"),
  statusSlug: text("status_slug").unique(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowEpoch),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowEpoch),
});

export const monitors = pgTable(
  "monitors",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    name: text("name"),
    method: text("method").notNull().default("GET"),
    intervalSec: integer("interval_sec").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(5000),
    retries: integer("retries").notNull().default(2),
    status: text("status").notNull().default("unknown"),
    lastCheckAt: bigint("last_check_at", { mode: "number" }),
    lastResponseMs: integer("last_response_ms"),
    isPublic: integer("is_public").notNull().default(1),
    isPaused: integer("is_paused").notNull().default(0),
    mutedUntil: bigint("muted_until", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowEpoch),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowEpoch),
  },
  (t) => [index("idx_monitors_user").on(t.userId)],
);

export const heartbeats = pgTable(
  "heartbeats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    statusCode: integer("status_code"),
    responseMs: integer("response_ms"),
    message: text("message"),
    createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowEpoch),
  },
  (t) => [index("idx_heartbeats_monitor_time").on(t.monitorId, t.createdAt)],
);

export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    endedAt: bigint("ended_at", { mode: "number" }),
    cause: text("cause"),
  },
  (t) => [index("idx_incidents_monitor").on(t.monitorId, t.startedAt)],
);

export const sslInfo = pgTable("ssl_info", {
  monitorId: text("monitor_id")
    .primaryKey()
    .references(() => monitors.id, { onDelete: "cascade" }),
  issuer: text("issuer"),
  validFrom: bigint("valid_from", { mode: "number" }),
  validTo: bigint("valid_to", { mode: "number" }),
  daysRemaining: integer("days_remaining"),
  checkedAt: bigint("checked_at", { mode: "number" }),
});

export const schema = { users, monitors, heartbeats, incidents, sslInfo };
