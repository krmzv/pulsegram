import type { Context } from "grammy";
import { buildStatusList } from "../../lib/telegram";
import { getUserByTelegram, listMonitors } from "../../modules/monitors/monitor.service";
import { chatId, replyMd, summarize } from "./helpers";

export async function listCommand(ctx: Context): Promise<void> {
  const cid = chatId(ctx);
  if (cid == null) return;
  const user = await getUserByTelegram(String(cid));
  if (!user) {
    await replyMd(ctx, "You're not monitoring anything yet\\.\nAdd one: `/add https://yoursite.com`");
    return;
  }
  const monitors = await listMonitors(user.id);
  const summaries = await summarize(monitors);
  await replyMd(ctx, buildStatusList(summaries));
}
