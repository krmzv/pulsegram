import type { Context } from "grammy";
import { escapeMd } from "../../lib/telegram";
import { getUserByTelegram, listMonitors } from "../../modules/monitors/monitor.service";
import { chatId, replyMd } from "./helpers";

export async function statusCommand(ctx: Context): Promise<void> {
  const cid = chatId(ctx);
  if (cid == null) return;
  const user = await getUserByTelegram(String(cid));
  const monitors = user ? await listMonitors(user.id) : [];
  if (monitors.length === 0) {
    await replyMd(ctx, "No monitors yet\\. Add one: `/add https://yoursite.com`");
    return;
  }
  const down = monitors.filter((m) => m.status === "down");
  const total = monitors.length;
  if (down.length === 0) {
    await replyMd(ctx, `✅ All ${total} monitor${total === 1 ? "" : "s"} operational\\.`);
    return;
  }
  const lines = down.map((m) => `🔴 ${escapeMd(m.url)}`);
  await replyMd(ctx, `⚠️ ${down.length} of ${total} down:\n${lines.join("\n")}`);
}
