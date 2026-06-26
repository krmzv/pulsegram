import type { Monitor } from "@pulsegram/shared";
import { nowSec, PLAN_LIMITS, SCHEDULER, SELF_HOSTED_LIMITS } from "@pulsegram/shared";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { loadConfig } from "../config";
import { getDb } from "../db";
import { checkUrl } from "../lib/http-check";
import { openIncident, rowToMonitor } from "../modules/monitors/monitor.service";
import { notifyDown, notifyRecovery } from "../bot/notifications";
import { decide } from "./state-machine";

// In-memory consecutive-failure counters. Persistence isn't needed: on restart
// we re-derive state from the next checks (a monitor that's truly down will
// fail again and re-alert at most once).
const failCounts = new Map<string, number>();

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastCleanupDay = -1;

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), SCHEDULER.tickMs);
  // run one immediately so a fresh `/add` is checked promptly
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    const due = await loadDueMonitors();
    for (let i = 0; i < due.length; i += SCHEDULER.batchSize) {
      const batch = due.slice(i, i + SCHEDULER.batchSize);
      await Promise.all(batch.map((m) => processMonitor(m)));
    }
    await maybeCleanup();
  } catch (err) {
    console.error("[scheduler] tick error:", err);
  } finally {
    ticking = false;
  }
}

async function loadDueMonitors(): Promise<Monitor[]> {
  const { db, t } = getDb();
  const now = nowSec();
  const rows = await db
    .select()
    .from(t.monitors)
    .where(
      and(
        eq(t.monitors.isPaused, 0),
        or(
          sql`${t.monitors.lastCheckAt} is null`,
          lt(t.monitors.lastCheckAt, sql`${now} - ${t.monitors.intervalSec}`),
        ),
      ),
    );
  return rows.map(rowToMonitor);
}

async function processMonitor(monitor: Monitor): Promise<void> {
  const cfg = loadConfig();
  const { db, t } = getDb();
  const result = await checkUrl(monitor.url, {
    timeoutMs: monitor.timeoutMs,
    allowPrivate: cfg.allowPrivateTargets,
    method: monitor.method,
  });
  const at = nowSec();

  // 1. record the raw heartbeat
  await db.insert(t.heartbeats).values({
    monitorId: monitor.id,
    status: result.status,
    statusCode: result.statusCode,
    responseMs: result.responseMs,
    message: result.message,
  });

  // 2. run the state machine → may transition monitor.status
  const muted = monitor.mutedUntil != null && monitor.mutedUntil > at;
  const fails = result.status === "down" ? (failCounts.get(monitor.id) ?? 0) + 1 : 0;
  if (result.status === "down") failCounts.set(monitor.id, fails);
  else failCounts.delete(monitor.id);

  const transition = decide(monitor.status, result.status, fails, monitor.retries);

  switch (transition) {
    case "recovered": {
      const incident = await openIncident(monitor.id);
      if (incident) {
        await db.update(t.incidents).set({ endedAt: at }).where(eq(t.incidents.id, incident.id));
        if (!muted) await notifyRecovery(monitor, { ...incident, endedAt: at }, at);
      }
      await db
        .update(t.monitors)
        .set({ status: "up", lastCheckAt: at, lastResponseMs: result.responseMs, updatedAt: at })
        .where(eq(t.monitors.id, monitor.id));
      break;
    }
    case "stay-up": {
      await db
        .update(t.monitors)
        .set({ status: "up", lastCheckAt: at, lastResponseMs: result.responseMs, updatedAt: at })
        .where(eq(t.monitors.id, monitor.id));
      break;
    }
    case "went-down": {
      await db.insert(t.incidents).values({
        monitorId: monitor.id,
        startedAt: at,
        cause: result.message,
      });
      await db
        .update(t.monitors)
        .set({ status: "down", lastCheckAt: at, lastResponseMs: result.responseMs, updatedAt: at })
        .where(eq(t.monitors.id, monitor.id));
      if (!muted) await notifyDown(monitor, result.message, at);
      break;
    }
    case "pending-down":
    case "stay-down": {
      await db
        .update(t.monitors)
        .set({ lastCheckAt: at, lastResponseMs: result.responseMs, updatedAt: at })
        .where(eq(t.monitors.id, monitor.id));
      break;
    }
  }
}

/** Once per day, delete heartbeats older than the retention window. */
async function maybeCleanup(): Promise<void> {
  const today = Math.floor(nowSec() / 86_400);
  if (today === lastCleanupDay) return;
  lastCleanupDay = today;
  const cfg = loadConfig();
  const { db, t } = getDb();
  const retentionDays = cfg.selfHosted ? SELF_HOSTED_LIMITS.retentionDays : PLAN_LIMITS.pro.retentionDays;
  const cutoff = nowSec() - retentionDays * 86_400;
  try {
    await db.delete(t.heartbeats).where(lt(t.heartbeats.createdAt, cutoff));
  } catch (err) {
    console.error("[scheduler] cleanup error:", err);
  }
}
