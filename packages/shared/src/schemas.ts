import { z } from "zod";
import { LIMITS } from "./constants";

/**
 * Normalize and validate a user-supplied monitor URL.
 * - prepends https:// when no scheme is given (bot-friendly: `/add example.com`)
 * - allows only http/https
 * - rejects embedded credentials (userinfo) — a common SSRF/phishing vector
 * - caps length
 *
 * Note: this is structural validation only. Network-level SSRF protection
 * (DNS resolution + private-IP blocking) lives in the API's ssrf-guard.
 */
export const monitorUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .max(LIMITS.maxUrlLength, "URL is too long")
  .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`))
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That doesn't look like a valid URL." });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only http and https URLs are supported." });
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URLs with embedded credentials aren't allowed." });
    }
    if (!url.hostname) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL is missing a hostname." });
    }
  });

export const addMonitorSchema = z.object({
  url: monitorUrlSchema,
  name: z.string().trim().max(LIMITS.maxNameLength).optional(),
});

export const monitorPatchSchema = z
  .object({
    name: z.string().trim().max(LIMITS.maxNameLength).nullable().optional(),
    intervalSec: z.number().int().min(10).max(86_400).optional(),
    timeoutMs: z.number().int().min(1000).max(60_000).optional(),
    retries: z.number().int().min(1).max(10).optional(),
    isPublic: z.boolean().optional(),
    isPaused: z.boolean().optional(),
  })
  .strict();

/** Status-page slug: lowercase alphanumerics + dashes, 3–32 chars. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,32}$/, "Slug must be 3–32 chars: lowercase letters, numbers, dashes.");

/** Parse a `/mute <hours>` argument into clamped hours. */
export const muteHoursSchema = z.coerce.number().int().min(1).max(720);

export type AddMonitorInput = z.infer<typeof addMonitorSchema>;
export type MonitorPatchInput = z.infer<typeof monitorPatchSchema>;
