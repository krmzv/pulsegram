import type { Context } from "grammy";
import { monitorUrlSchema } from "@pulsegram/shared";
import { escapeMd } from "../../lib/telegram";
import { getUserByTelegram, removeMonitorByUrl } from "../../modules/monitors/monitor.service";
import { chatId, replyMd } from "./helpers";

export async function removeCommand(ctx: Context): Promise<void> {
  const cid = chatId(ctx);
  if (cid == null) return;
  const raw = (ctx.match ?? "").toString().trim();
  if (!raw) {
    await replyMd(ctx, "Usage: `/remove https://yoursite.com`");
    return;
  }
  const parsed = monitorUrlSchema.safeParse(raw);
  if (!parsed.success) {
    await replyMd(ctx, "⚠️ That doesn't look like a valid URL\\.");
    return;
  }
  const user = await getUserByTelegram(String(cid));
  if (!user) {
    await replyMd(ctx, "You're not monitoring anything yet\\.");
    return;
  }
  const removed = await removeMonitorByUrl(user.id, parsed.data);
  if (removed) {
    await replyMd(ctx, `🗑️ Stopped monitoring ${escapeMd(parsed.data)}\\.`);
  } else {
    await replyMd(ctx, `I wasn't monitoring ${escapeMd(parsed.data)}\\.`);
  }
}
