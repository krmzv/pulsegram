import type { Incident, Monitor, MonitorStatus } from "@pulsegram/shared";
import { DEFAULTS, nameFromUrl, nowSec } from "@pulsegram/shared";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db";

type Row = Record<string, unknown>;

export function rowToMonitor(r: Row): Monitor {
  return {
    id: r.id as string,
    userId: r.userId as string,
    url: r.url as string,
    name: (r.name as string | null) ?? null,
    method: r.method as string,
    intervalSec: r.intervalSec as number,
    timeoutMs: r.timeoutMs as number,
    retries: r.retries as number,
    status: r.status as MonitorStatus,
    lastCheckAt: (r.lastCheckAt as number | null) ?? null,
    lastResponseMs: (r.lastResponseMs as number | null) ?? null,
    isPublic: Boolean(r.isPublic),
    isPaused: Boolean(r.isPaused),
    mutedUntil: (r.mutedUntil as number | null) ?? null,
    createdAt: r.createdAt as number,
    updatedAt: r.updatedAt as number,
  };
}

// ── Users ────────────────────────────────────────────────
export async function findOrCreateUserByTelegram(telegramId: string): Promise<{ id: string; plan: string }> {
  const { db, t } = getDb();
  const existing = await db.select().from(t.users).where(eq(t.users.telegramId, telegramId)).limit(1);
  if (existing[0]) return { id: existing[0].id, plan: existing[0].plan };
  const inserted = await db
    .insert(t.users)
    .values({ telegramId, plan: "free" })
    .returning({ id: t.users.id, plan: t.users.plan });
  return { id: inserted[0]!.id, plan: inserted[0]!.plan };
}

export async function getUserByTelegram(telegramId: string): Promise<{ id: string; plan: string } | null> {
  const { db, t } = getDb();
  const rows = await db
    .select({ id: t.users.id, plan: t.users.plan })
    .from(t.users)
    .where(eq(t.users.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

// ── Monitors ─────────────────────────────────────────────
export async function listMonitors(userId: string): Promise<Monitor[]> {
  const { db, t } = getDb();
  const rows = await db
    .select()
    .from(t.monitors)
    .where(eq(t.monitors.userId, userId))
    .orderBy(desc(t.monitors.createdAt));
  return rows.map(rowToMonitor);
}

export async function countMonitors(userId: string): Promise<number> {
  const { db, t } = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(t.monitors)
    .where(eq(t.monitors.userId, userId));
  return Number(rows[0]?.n ?? 0);
}

export async function findMonitorByUrl(userId: string, url: string): Promise<Monitor | null> {
  const { db, t } = getDb();
  const rows = await db
    .select()
    .from(t.monitors)
    .where(and(eq(t.monitors.userId, userId), eq(t.monitors.url, url)))
    .limit(1);
  return rows[0] ? rowToMonitor(rows[0]) : null;
}

export async function createMonitor(userId: string, url: string, name?: string): Promise<Monitor> {
  const { db, t } = getDb();
  const rows = await db
    .insert(t.monitors)
    .values({
      userId,
      url,
      name: name ?? nameFromUrl(url),
      intervalSec: DEFAULTS.intervalSec,
      timeoutMs: DEFAULTS.timeoutMs,
      retries: DEFAULTS.retries,
      method: DEFAULTS.method,
    })
    .returning();
  return rowToMonitor(rows[0] as Row);
}

/** Remove a monitor owned by this user. Returns true if something was deleted. */
export async function removeMonitorByUrl(userId: string, url: string): Promise<boolean> {
  const { db, t } = getDb();
  const existing = await findMonitorByUrl(userId, url);
  if (!existing) return false;
  await db.delete(t.monitors).where(eq(t.monitors.id, existing.id));
  return true;
}

/** Mute all of a user's monitors until `until` (epoch seconds). */
export async function muteUserMonitors(userId: string, until: number): Promise<number> {
  const { db, t } = getDb();
  const affected = await db
    .update(t.monitors)
    .set({ mutedUntil: until, updatedAt: nowSec() })
    .where(eq(t.monitors.userId, userId))
    .returning({ id: t.monitors.id });
  return affected.length;
}

// ── Heartbeat-derived stats ──────────────────────────────
/** Uptime % over the last `windowSec` seconds for one monitor. */
export async function uptimeForMonitor(monitorId: string, windowSec: number): Promise<number | null> {
  const { db, t } = getDb();
  const since = nowSec() - windowSec;
  const rows = await db
    .select({
      total: sql<number>`count(*)`,
      up: sql<number>`sum(case when ${t.heartbeats.status} = 'up' then 1 else 0 end)`,
    })
    .from(t.heartbeats)
    .where(and(eq(t.heartbeats.monitorId, monitorId), gte(t.heartbeats.createdAt, since)));
  const total = Number(rows[0]?.total ?? 0);
  if (total === 0) return null;
  const up = Number(rows[0]?.up ?? 0);
  return (up / total) * 100;
}

/** The currently-open incident for a monitor, if any. */
export async function openIncident(monitorId: string): Promise<Incident | null> {
  const { db, t } = getDb();
  const rows = await db
    .select()
    .from(t.incidents)
    .where(and(eq(t.incidents.monitorId, monitorId), isNull(t.incidents.endedAt)))
    .orderBy(desc(t.incidents.startedAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    monitorId: r.monitorId,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
    cause: r.cause ?? null,
  };
}
