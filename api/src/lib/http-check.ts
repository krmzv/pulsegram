import type { CheckResult } from "@pulsegram/shared";
import { SCHEDULER, USER_AGENT } from "@pulsegram/shared";
import { assertSafeUrl, SsrfError } from "./ssrf-guard";

export interface CheckOptions {
  timeoutMs: number;
  allowPrivate: boolean;
  method?: string;
}

/**
 * Perform a single uptime check for a URL.
 *
 * Security-critical replacement for the naive `fetch(url, { redirect: 'follow' })`:
 *   - SSRF guard is run before the request AND before each redirect hop, so an
 *     open redirect can't bounce us into the internal network.
 *   - Redirects are followed manually (`redirect: 'manual'`) up to a small cap.
 *   - A hard timeout aborts slow targets.
 *   - The response body is drained but capped, so a malicious target can't make
 *     us buffer gigabytes — we only care about the status line.
 *
 * Up = final response is 2xx or 3xx. Everything else (4xx/5xx, timeout, DNS
 * failure, connection refused, SSRF rejection) is Down with a human message.
 */
export async function checkUrl(rawUrl: string, opts: CheckOptions): Promise<CheckResult> {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  let currentUrl = rawUrl;

  try {
    for (let hop = 0; hop <= SCHEDULER.maxRedirects; hop++) {
      // Re-validate every hop. Throws SsrfError if it resolves to a private IP.
      await assertSafeUrl(currentUrl, opts.allowPrivate);

      const res = await fetch(currentUrl, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      });

      // Manual redirect handling.
      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        await drainCapped(res);
        if (hop === SCHEDULER.maxRedirects) {
          return down(res.status, elapsed(), "Too many redirects");
        }
        const location = res.headers.get("location")!;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      await drainCapped(res);
      const ok = res.status >= 200 && res.status < 400;
      return {
        status: ok ? "up" : "down",
        statusCode: res.status,
        responseMs: elapsed(),
        message: ok ? null : `HTTP ${res.status}`,
      };
    }
    // Unreachable, but satisfies the type checker.
    return down(null, elapsed(), "Too many redirects");
  } catch (err) {
    return down(null, elapsed(), describeError(err));
  }
}

function down(statusCode: number | null, responseMs: number, message: string): CheckResult {
  return { status: "down", statusCode, responseMs, message: message.slice(0, 200) };
}

/** Read and discard the body, aborting if it exceeds the cap. */
async function drainCapped(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > SCHEDULER.maxBodyBytes) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // body read errors are irrelevant to up/down — status line already captured
  } finally {
    reader.releaseLock?.();
  }
}

function describeError(err: unknown): string {
  if (err instanceof SsrfError) return err.message;
  if (err instanceof DOMException && err.name === "TimeoutError") return "Connection timeout";
  if (err instanceof Error) {
    const msg = err.message || err.name;
    if (/timeout/i.test(msg)) return "Connection timeout";
    if (/ENOTFOUND|getaddrinfo|dns/i.test(msg)) return "DNS lookup failed";
    if (/ECONNREFUSED|refused/i.test(msg)) return "Connection refused";
    if (/certificate|SSL|TLS/i.test(msg)) return "TLS/certificate error";
    return msg;
  }
  return "Unknown error";
}
