import type { Context } from "grammy";
import { addMonitorSchema, PLAN_LIMITS } from "@pulsegram/shared";
import { loadConfig } from "../../config";
import { assertSafeUrl, SsrfError } from "../../lib/ssrf-guard";
import { buildAddedConfirmation, buildLimitReached, escapeMd } from "../../lib/telegram";
import {
  countMonitors,
  createMonitor,
  findMonitorByUrl,
  findOrCreateUserByTelegram,
} from "../../modules/monitors/monitor.service";
import { chatId, replyMd } from "./helpers";

export async function addCommand(ctx: Context): Promise<void> {
  const cid = chatId(ctx);
  if (cid == null) return;

  const raw = (ctx.match ?? "").toString().trim();
  if (!raw) {
    await replyMd(ctx, "Usage: `/add https://yoursite.com`");
    return;
  }

  // 1. structural validation + normalization (adds https:// if missing)
  const parsed = addMonitorSchema.safeParse({ url: raw });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "That doesn't look like a valid URL.";
    await replyMd(ctx, `⚠️ ${escapeMd(msg)}`);
    return;
  }
  const url = parsed.data.url;
  const cfg = loadConfig();

  // 2. SSRF guard — reject private/internal/metadata targets up front
  try {
    await assertSafeUrl(url, cfg.allowPrivateTargets);
  } catch (err) {
    const msg = err instanceof SsrfError ? err.message : "Could not validate that URL.";
    await replyMd(ctx, `⚠️ ${escapeMd(msg)}`);
    return;
  }

  const user = await findOrCreateUserByTelegram(String(cid));

  // 3. dedupe
  if (await findMonitorByUrl(user.id, url)) {
    await replyMd(ctx, `You're already monitoring ${escapeMd(url)}\\.`);
    return;
  }

  // 4. plan limit (skipped entirely when self-hosted)
  if (!cfg.selfHosted) {
    const limit = PLAN_LIMITS[user.plan === "pro" ? "pro" : "free"].monitors;
    const current = await countMonitors(user.id);
    if (current >= limit) {
      const upgradeUrl = `${cfg.baseUrl}/upgrade?ref=tg_${cid}`;
      await replyMd(ctx, buildLimitReached(upgradeUrl));
      return;
    }
  }

  const monitor = await createMonitor(user.id, url);
  await replyMd(ctx, buildAddedConfirmation(monitor, cfg.baseUrl));
}
