import { nowSec } from "@pulsegram/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config";
import { getDb } from "../db";
import { notifyDown, notifyRecovery } from "../bot/notifications";
import { openIncident, rowToMonitor } from "../modules/monitors/monitor.service";

type IncidentBody = {
  event_id?: number;
  monitor_id: string;
  checked_at: number;
  error: string | null;
};

type RecoveryBody = {
  event_id?: number;
  monitor_id: string;
  recovered_at: number;
};

async function markDelivered(eventId: number | undefined): Promise<void> {
  if (!eventId) return;
  const { db, t } = getDb();
  await db
    .update(t.pendingEvents)
    .set({ status: "delivered", deliveredAt: nowSec() })
    .where(eq(t.pendingEvents.id, eventId));
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/internal/")) return;
    const cfg = loadConfig();
    if (req.headers["x-internal-secret"] !== cfg.internalSecret) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.post<{ Body: IncidentBody }>("/internal/incident", async (req, reply) => {
    const { event_id, monitor_id, checked_at, error } = req.body;
    const { db, t } = getDb();

    const rows = await db.select().from(t.monitors).where(eq(t.monitors.id, monitor_id)).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "monitor not found" });
    const monitor = rowToMonitor(rows[0] as Record<string, unknown>);

    // idempotency: skip if already open
    const existing = await openIncident(monitor_id);
    if (!existing) {
      await db.insert(t.incidents).values({ monitorId: monitor_id, startedAt: checked_at, cause: error });
    }

    if (!monitor.lastCheckAt || monitor.lastCheckAt <= checked_at) {
      await db
        .update(t.monitors)
        .set({ status: "down", lastCheckAt: checked_at, updatedAt: checked_at })
        .where(eq(t.monitors.id, monitor_id));
    }

    const muted = monitor.mutedUntil != null && monitor.mutedUntil > checked_at;
    if (!muted && !existing) await notifyDown(monitor, error, checked_at);

    await markDelivered(event_id);
    return { ok: true };
  });

  app.post<{ Body: RecoveryBody }>("/internal/recovery", async (req, reply) => {
    const { event_id, monitor_id, recovered_at } = req.body;
    const { db, t } = getDb();

    const rows = await db.select().from(t.monitors).where(eq(t.monitors.id, monitor_id)).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "monitor not found" });
    const monitor = rowToMonitor(rows[0] as Record<string, unknown>);

    const incident = await openIncident(monitor_id);
    if (incident) {
      await db.update(t.incidents).set({ endedAt: recovered_at }).where(eq(t.incidents.id, incident.id));
      const muted = monitor.mutedUntil != null && monitor.mutedUntil > recovered_at;
      if (!muted) await notifyRecovery(monitor, { ...incident, endedAt: recovered_at }, recovered_at);
    }

    if (!monitor.lastCheckAt || monitor.lastCheckAt <= recovered_at) {
      await db
        .update(t.monitors)
        .set({ status: "up", lastCheckAt: recovered_at, updatedAt: recovered_at })
        .where(eq(t.monitors.id, monitor_id));
    }

    await markDelivered(event_id);
    return { ok: true };
  });
}
