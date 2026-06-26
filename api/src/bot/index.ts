import { getBot } from "./bot";
import { registerCommands } from "./commands";

let started = false;

/**
 * Register handlers and begin long polling. Long polling needs no public URL or
 * inbound port — ideal for zero-friction self-hosting behind NAT.
 */
export async function startBot(): Promise<void> {
  if (started) return;
  const bot = getBot();
  registerCommands(bot);

  bot.catch((err) => {
    console.error("[bot] uncaught error:", err.error);
  });

  // bot.start() resolves only when the bot stops, so we don't await it here.
  void bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.log(`🤖 Bot @${info.username} is live (long polling)`),
  });
  started = true;
}

export async function stopBot(): Promise<void> {
  if (!started) return;
  await getBot().stop();
  started = false;
}
