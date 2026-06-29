import { nowSec } from "@pulsegram/shared";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { notifyDown, notifyRecovery } from "../bot/notifications";
import { openIncident, rowToMonitor } from "../modules/monitors/monitor.service";

const BATCH = 50;

export async function pollPendingEvents(): Promise<void> {
  const { db, t } = getDb();

  const pending = await db
    .select()
    .from(t.pendingEvents)
    .where(eq(t.pendingEvents.status, "pending"))
    .limit(BATCH);

  if (pending.length === 0) return;

  for (const event of pending) {
    try {
      await processEvent(event);
      await db
        .update(t.pendingEvents)
        .set({ status: "delivered", deliveredAt: nowSec() })
        .where(and(eq(t.pendingEvents.id, event.id), eq(t.pendingEvents.status, "pending")));
    } catch (err) {
      console.error(`[event-poller] failed to process event ${event.id}:`, err);
    }
  }
}

async function processEvent(event: {
  id: number;
  monitorId: string;
  eventType: string;
  payload: string;
}): Promise<void> {
  const { db, t } = getDb();

  const rows = await db.select().from(t.monitors).where(eq(t.monitors.id, event.monitorId)).limit(1);
  if (!rows[0]) return;
  const monitor = rowToMonitor(rows[0] as Record<string, unknown>);
  const payload = JSON.parse(event.payload) as Record<string, unknown>;

  if (event.eventType === "incident") {
    const checkedAt = payload.checked_at as number;
    const error = (payload.error as string | null) ?? null;
    const muted = monitor.mutedUntil != null && monitor.mutedUntil > checkedAt;

    const existing = await openIncident(event.monitorId);
    if (!existing) {
      await db.insert(t.incidents).values({ monitorId: event.monitorId, startedAt: checkedAt, cause: error });
      if (!muted) await notifyDown(monitor, error, checkedAt);
    }

    if (!monitor.lastCheckAt || monitor.lastCheckAt <= checkedAt) {
      await db
        .update(t.monitors)
        .set({ status: "down", lastCheckAt: checkedAt, updatedAt: checkedAt })
        .where(eq(t.monitors.id, event.monitorId));
    }
  } else if (event.eventType === "recovery") {
    const recoveredAt = payload.recovered_at as number;
    const muted = monitor.mutedUntil != null && monitor.mutedUntil > recoveredAt;

    const incident = await openIncident(event.monitorId);
    if (incident) {
      await db.update(t.incidents).set({ endedAt: recoveredAt }).where(eq(t.incidents.id, incident.id));
      if (!muted) await notifyRecovery(monitor, { ...incident, endedAt: recoveredAt }, recoveredAt);
    }

    if (!monitor.lastCheckAt || monitor.lastCheckAt <= recoveredAt) {
      await db
        .update(t.monitors)
        .set({ status: "up", lastCheckAt: recoveredAt, updatedAt: recoveredAt })
        .where(eq(t.monitors.id, event.monitorId));
    }
  }
}
