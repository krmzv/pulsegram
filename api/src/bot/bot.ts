import { Bot } from "grammy";
import { loadConfig } from "../config";

let bot: Bot | null = null;

/** Lazily-constructed singleton grammY bot. */
export function getBot(): Bot {
  if (bot) return bot;
  const cfg = loadConfig();
  bot = new Bot(cfg.telegramBotToken);
  return bot;
}

// ── Per-chat rate limiting ───────────────────────────────
// Simple token bucket keyed by chat id, to stop a single user from hammering
// the bot (and us) with commands.
const buckets = new Map<number, { tokens: number; updated: number }>();
const RATE = { capacity: 10, refillPerSec: 1 };

export function allowCommand(chatId: number): boolean {
  const now = Date.now() / 1000;
  const b = buckets.get(chatId) ?? { tokens: RATE.capacity, updated: now };
  const refill = (now - b.updated) * RATE.refillPerSec;
  b.tokens = Math.min(RATE.capacity, b.tokens + refill);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(chatId, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(chatId, b);
  return true;
}
