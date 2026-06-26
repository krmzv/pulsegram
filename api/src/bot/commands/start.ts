import type { Context } from "grammy";
import { WELCOME } from "../../lib/telegram";
import { replyMd } from "./helpers";

export async function startCommand(ctx: Context): Promise<void> {
  await replyMd(ctx, WELCOME);
}
