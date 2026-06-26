import type { Bot, Context } from "grammy";
import { allowCommand } from "../bot";
import { addCommand } from "./add";
import { listCommand } from "./list";
import { muteCommand } from "./mute";
import { removeCommand } from "./remove";
import { startCommand } from "./start";
import { statusCommand } from "./status";
import { upgradeCommand } from "./upgrade";

type Handler = (ctx: Context) => Promise<void>;

/** Wrap a handler with per-chat rate limiting + error isolation. */
function guard(handler: Handler): Handler {
  return async (ctx) => {
    const cid = ctx.chat?.id;
    if (cid != null && !allowCommand(cid)) {
      await ctx.reply("⏳ Slow down a sec — too many commands.");
      return;
    }
    try {
      await handler(ctx);
    } catch (err) {
      console.error(`[bot] handler error:`, err);
      await ctx.reply("⚠️ Something went wrong handling that. Try again in a moment.");
    }
  };
}

export function registerCommands(bot: Bot): void {
  bot.command("start", guard(startCommand));
  bot.command("add", guard(addCommand));
  bot.command("list", guard(listCommand));
  bot.command("status", guard(statusCommand));
  bot.command("remove", guard(removeCommand));
  bot.command("mute", guard(muteCommand));
  bot.command("upgrade", guard(upgradeCommand));

  bot.command("help", guard(startCommand));

  // Friendly nudge for non-command messages.
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await ctx.reply("Try /add <url> to start monitoring, or /list to see your monitors.");
  });

  // Set the command menu shown in Telegram's UI.
  void bot.api
    .setMyCommands([
      { command: "add", description: "Monitor a new URL" },
      { command: "list", description: "Show your monitors" },
      { command: "status", description: "Quick health summary" },
      { command: "remove", description: "Stop monitoring a URL" },
      { command: "mute", description: "Silence alerts for N hours" },
      { command: "upgrade", description: "Upgrade to Pro" },
    ])
    .catch(() => {});
}
