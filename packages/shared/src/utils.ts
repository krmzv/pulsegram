import type { Heartbeat, HeartbeatStatus } from "./types";

/** Current epoch in seconds. */
export const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * Uptime percentage from a set of heartbeats (up beats / total beats).
 * Returns null when there's no data so callers can render "—".
 */
export function uptimePercent(beats: Pick<Heartbeat, "status">[]): number | null {
  if (beats.length === 0) return null;
  const up = beats.reduce((n, b) => n + (b.status === "up" ? 1 : 0), 0);
  return (up / beats.length) * 100;
}

/** Format an uptime percentage like Better Stack: `99.94%`, `100%`, or `—`. */
export function formatUptime(pct: number | null): string {
  if (pct === null) return "—";
  if (pct >= 100) return "100%";
  return `${pct.toFixed(2)}%`;
}

/** Human duration from a number of seconds: `3m 42s`, `2h 5m`, `45s`. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `${d}d ${rem}h` : `${d}d`;
}

/** Relative time from an epoch-seconds timestamp: `30s ago`, `4m ago`, `2h ago`. */
export function relativeTime(epochSec: number | null, now: number = nowSec()): string {
  if (epochSec === null) return "never";
  const diff = Math.max(0, now - epochSec);
  if (diff < 5) return "just now";
  return `${formatDuration(diff)} ago`;
}

/**
 * Derive a friendly monitor name from a URL hostname.
 * `https://api.example.com/health` → `api.example.com`.
 */
export function nameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Short display host for messages: strips a leading `www.`. */
export function displayHost(url: string): string {
  const host = nameFromUrl(url);
  return host.replace(/^www\./, "");
}

export function isUp(status: HeartbeatStatus): boolean {
  return status === "up";
}
