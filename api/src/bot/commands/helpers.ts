import type { Context } from "grammy";
import type { Monitor } from "@pulsegram/shared";
import type { MonitorSummary } from "../../lib/telegram";
import { openIncident, uptimeForMonitor } from "../../modules/monitors/monitor.service";

/** Uptime window shown in bot summaries (7 days). */
const UPTIME_WINDOW_SEC = 7 * 86_400;

export async function summarize(monitors: Monitor[]): Promise<MonitorSummary[]> {
  return Promise.all(
    monitors.map(async (monitor) => {
      const uptimePct = await uptimeForMonitor(monitor.id, UPTIME_WINDOW_SEC);
      let downSince: number | null = null;
      if (monitor.status === "down") {
        const incident = await openIncident(monitor.id);
        downSince = incident?.startedAt ?? null;
      }
      return { monitor, uptimePct, downSince };
    }),
  );
}

/** First whitespace-delimited argument after the command. */
export function firstArg(ctx: Context): string {
  return (ctx.match ?? "").toString().trim().split(/\s+/)[0] ?? "";
}

export function chatId(ctx: Context): number | null {
  return ctx.chat?.id ?? null;
}

/** Reply using MarkdownV2 formatting. */
export async function replyMd(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, { parse_mode: "MarkdownV2" });
}
