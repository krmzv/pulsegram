import type { Incident, Monitor } from "@pulsegram/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { buildDownAlert, buildRecoveryAlert } from "../lib/telegram";
import { getBot } from "./bot";

async function telegramIdForMonitor(monitor: Monitor): Promise<string | null> {
  const { db, t } = getDb();
  const rows = await db
    .select({ telegramId: t.users.telegramId })
    .from(t.users)
    .where(eq(t.users.id, monitor.userId))
    .limit(1);
  return rows[0]?.telegramId ?? null;
}

async function send(chatId: string, text: string): Promise<void> {
  try {
    await getBot().api.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
  } catch (err) {
    console.error(`[notify] failed to message ${chatId}:`, err);
  }
}

export async function notifyDown(monitor: Monitor, cause: string | null, at: number): Promise<void> {
  const chatId = await telegramIdForMonitor(monitor);
  if (chatId) await send(chatId, buildDownAlert(monitor, cause, at));
}

export async function notifyRecovery(monitor: Monitor, incident: Incident, at: number): Promise<void> {
  const chatId = await telegramIdForMonitor(monitor);
  if (chatId) await send(chatId, buildRecoveryAlert(monitor, incident, at));
}
