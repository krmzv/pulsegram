import type { Context } from "grammy";
import { muteHoursSchema, nowSec } from "@pulsegram/shared";
import { getUserByTelegram, muteUserMonitors } from "../../modules/monitors/monitor.service";
import { chatId, replyMd } from "./helpers";

export async function muteCommand(ctx: Context): Promise<void> {
  const cid = chatId(ctx);
  if (cid == null) return;
  const raw = (ctx.match ?? "").toString().trim();
  const parsed = muteHoursSchema.safeParse(raw || "1");
  if (!parsed.success) {
    await replyMd(ctx, "Usage: `/mute <hours>` \\(1–720\\)");
    return;
  }
  const user = await getUserByTelegram(String(cid));
  if (!user) {
    await replyMd(ctx, "You're not monitoring anything yet\\.");
    return;
  }
  const until = nowSec() + parsed.data * 3600;
  const n = await muteUserMonitors(user.id, until);
  await replyMd(ctx, `🔕 Muted alerts for ${parsed.data}h across ${n} monitor${n === 1 ? "" : "s"}\\.`);
}
