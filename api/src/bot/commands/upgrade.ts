import type { Context } from "grammy";
import { loadConfig } from "../../config";
import { escapeMd } from "../../lib/telegram";
import { chatId, replyMd } from "./helpers";

export async function upgradeCommand(ctx: Context): Promise<void> {
  const cfg = loadConfig();
  if (cfg.selfHosted) {
    await replyMd(ctx, "✨ You're self\\-hosting — everything's unlimited\\. No upgrade needed\\.");
    return;
  }
  const cid = chatId(ctx);
  const url = `${cfg.baseUrl}/upgrade${cid != null ? `?ref=tg_${cid}` : ""}`;
  await replyMd(ctx, `Upgrade to Pro \\($5/mo\\) for up to 25 monitors:\n${escapeMd(url)}`);
}
