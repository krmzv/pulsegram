import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const nowEpoch = sql`(unixepoch())`;

export const users = sqliteTable("users", {
  id: id(),
  telegramId: text("telegram_id").unique(),
  email: text("email").unique(),
  plan: text("plan").notNull().default("free"),
  statusSlug: text("status_slug").unique(),
  createdAt: integer("created_at").notNull().default(nowEpoch),
  updatedAt: integer("updated_at").notNull().default(nowEpoch),
});

export const monitors = sqliteTable(
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
    lastCheckAt: integer("last_check_at"),
    lastResponseMs: integer("last_response_ms"),
    isPublic: integer("is_public").notNull().default(1),
    isPaused: integer("is_paused").notNull().default(0),
    mutedUntil: integer("muted_until"),
    createdAt: integer("created_at").notNull().default(nowEpoch),
    updatedAt: integer("updated_at").notNull().default(nowEpoch),
  },
  (t) => [index("idx_monitors_user").on(t.userId)],
);

export const heartbeats = sqliteTable(
  "heartbeats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    statusCode: integer("status_code"),
    responseMs: integer("response_ms"),
    message: text("message"),
    createdAt: integer("created_at").notNull().default(nowEpoch),
  },
  (t) => [index("idx_heartbeats_monitor_time").on(t.monitorId, t.createdAt)],
);

export const incidents = sqliteTable(
  "incidents",
  {
    id: id(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    cause: text("cause"),
  },
  (t) => [index("idx_incidents_monitor").on(t.monitorId, t.startedAt)],
);

export const sslInfo = sqliteTable("ssl_info", {
  monitorId: text("monitor_id")
    .primaryKey()
    .references(() => monitors.id, { onDelete: "cascade" }),
  issuer: text("issuer"),
  validFrom: integer("valid_from"),
  validTo: integer("valid_to"),
  daysRemaining: integer("days_remaining"),
  checkedAt: integer("checked_at"),
});

export const pendingEvents = sqliteTable(
  "pending_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // 'incident' | 'recovery'
    payload: text("payload").notNull(), // JSON string
    status: text("status").notNull().default("pending"), // 'pending' | 'delivered'
    createdAt: integer("created_at").notNull().default(nowEpoch),
    deliveredAt: integer("delivered_at"),
  },
  (t) => [index("idx_pending_events_status").on(t.status)],
);

export const schema = { users, monitors, heartbeats, incidents, sslInfo, pendingEvents };
