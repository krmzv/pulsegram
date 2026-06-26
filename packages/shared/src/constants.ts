import type { Plan } from "./types";

/** Monitor defaults — opinionated, the user shouldn't have to configure these. */
export const DEFAULTS = {
  intervalSec: 60,
  timeoutMs: 5000,
  retries: 3,
  method: "GET",
} as const;

/** Scheduler tuning. */
export const SCHEDULER = {
  /** how often the scheduler wakes up to find due monitors */
  tickMs: 10_000,
  /** max concurrent HTTP checks per batch */
  batchSize: 50,
  /** max bytes we read from a response body before aborting (we only need status) */
  maxBodyBytes: 256 * 1024,
  /** max redirect hops we follow manually (each re-validated for SSRF) */
  maxRedirects: 3,
  /** how often SSL certs are re-checked */
  sslRecheckMs: 24 * 60 * 60 * 1000,
} as const;

export interface PlanLimits {
  monitors: number;
  minIntervalSec: number;
  retentionDays: number;
  sslMonitoring: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { monitors: 1, minIntervalSec: 60, retentionDays: 7, sslMonitoring: false },
  pro: { monitors: 25, minIntervalSec: 30, retentionDays: 90, sslMonitoring: true },
};

/** When SELF_HOSTED=true, limits are lifted entirely. */
export const SELF_HOSTED_LIMITS: PlanLimits = {
  monitors: Number.POSITIVE_INFINITY,
  minIntervalSec: 60,
  retentionDays: 90,
  sslMonitoring: true,
};

export const USER_AGENT = "Pulsegram/1.0 (+https://github.com/krmzv/pulsegram)";

export const LIMITS = {
  maxUrlLength: 2048,
  maxNameLength: 80,
  /** warn when a TLS cert has fewer than this many days remaining */
  sslWarnDays: 14,
} as const;

/**
 * Reserved / private IPv4 ranges that must never be the target of a monitor
 * (SSRF protection). Includes loopback, RFC1918, link-local (cloud metadata),
 * CGNAT, and other special-use blocks.
 */
export const BLOCKED_IPV4_CIDRS: ReadonlyArray<string> = [
  "0.0.0.0/8", // "this" network
  "10.0.0.0/8", // RFC1918 private
  "100.64.0.0/10", // CGNAT (RFC6598)
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local — includes 169.254.169.254 cloud metadata
  "172.16.0.0/12", // RFC1918 private
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16", // RFC1918 private
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved
  "255.255.255.255/32", // broadcast
];

/** Reserved / private IPv6 ranges. IPv4-mapped (::ffff:0:0/96) is handled by
 * unwrapping to IPv4 and checking the v4 list. */
export const BLOCKED_IPV6_CIDRS: ReadonlyArray<string> = [
  "::1/128", // loopback
  "::/128", // unspecified
  "fc00::/7", // unique local addresses
  "fe80::/10", // link-local
  "ff00::/8", // multicast
  "2001:db8::/32", // documentation
  "64:ff9b::/96", // NAT64 (can map to private v4)
  "100::/64", // discard-only
];
