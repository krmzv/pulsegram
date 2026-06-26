import type { Incident, Monitor } from "@pulsegram/shared";
import { displayHost, formatDuration, formatUptime, nowSec, relativeTime } from "@pulsegram/shared";

/**
 * Escape arbitrary text for Telegram MarkdownV2. User-controlled values (URLs,
 * upstream error messages, hostnames) must always pass through this before
 * being embedded in a formatted message, or a crafted error string could break
 * out of the formatting / inject entities.
 */
export function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const dot = (status: Monitor["status"]): string =>
  status === "up" ? "🟢" : status === "down" ? "🔴" : "⚪️";

function fmtTimeUtc(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export interface MonitorSummary {
  monitor: Monitor;
  uptimePct: number | null;
  /** when down: epoch seconds the current incident started */
  downSince: number | null;
}

/** The `/list` and `/status` multi-monitor message. */
export function buildStatusList(items: MonitorSummary[]): string {
  if (items.length === 0) {
    return "📡 *Your monitors*\n\nYou're not monitoring anything yet\\.\nAdd one: `/add https://yoursite.com`";
  }
  const blocks = items.map(({ monitor, uptimePct, downSince }) => {
    const host = escapeMd(displayHost(monitor.url));
    const head = `${dot(monitor.status)} ${host}`;
    const uptime = `├ Uptime: ${escapeMd(formatUptime(uptimePct))}`;
    let third: string;
    let fourth: string;
    if (monitor.status === "down") {
      const since = downSince ? relativeTime(downSince) : "recently";
      third = `├ Down since: ${escapeMd(since)}`;
      fourth = `└ Error: ${escapeMd(monitor.name ? monitor.name : "unreachable")}`;
    } else {
      const resp = monitor.lastResponseMs != null ? `${monitor.lastResponseMs}ms` : "—";
      third = `├ Response: ${escapeMd(resp)}`;
      fourth = `└ Checked: ${escapeMd(relativeTime(monitor.lastCheckAt))}`;
    }
    return `${head}\n${uptime}\n${third}\n${fourth}`;
  });
  return `📡 *Your monitors*\n\n${blocks.join("\n\n")}`;
}

/** 🔴 DOWN alert sent when a monitor transitions UP → DOWN. */
export function buildDownAlert(monitor: Monitor, cause: string | null, at: number): string {
  return [
    `🔴 *DOWN* — ${escapeMd(displayHost(monitor.url))}`,
    `Reason: ${escapeMd(cause ?? "unreachable")}`,
    `Time: ${escapeMd(fmtTimeUtc(at))}`,
    `Duration: ongoing`,
  ].join("\n");
}

/** 🟢 RECOVERED alert sent when a monitor transitions DOWN → UP. */
export function buildRecoveryAlert(monitor: Monitor, incident: Incident, at: number): string {
  const downFor = formatDuration(at - incident.startedAt);
  return [
    `🟢 *RECOVERED* — ${escapeMd(displayHost(monitor.url))}`,
    `Was down for: ${escapeMd(downFor)}`,
    `Time: ${escapeMd(fmtTimeUtc(at))}`,
  ].join("\n");
}

export function buildAddedConfirmation(monitor: Monitor, baseUrl: string): string {
  const host = escapeMd(displayHost(monitor.url));
  const lines = [
    `✅ Monitoring ${host}`,
    "",
    `I'll check it every ${monitor.intervalSec} seconds and alert you here if it goes down\\. That's it\\. You're set\\.`,
  ];
  if (baseUrl) lines.push("", `📊 Dashboard: ${escapeMd(baseUrl)}`);
  return lines.join("\n");
}

export const WELCOME = [
  "👋 *Welcome to Pulsegram\\!*",
  "",
  "I monitor your websites and ping you here when they go down\\.",
  "",
  "Add your first site \\(it's free\\):",
  "`/add https://yoursite.com`",
].join("\n");

export function buildLimitReached(upgradeUrl: string | null): string {
  const lines = ["⚡ You've used your free monitor slot\\.", ""];
  if (upgradeUrl) {
    lines.push(`Upgrade to Pro to monitor more sites:`, escapeMd(upgradeUrl), "");
  }
  lines.push("Or self\\-host Pulsegram for free with unlimited monitors\\.");
  return lines.join("\n");
}

export { nowSec };
