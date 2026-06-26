export type Plan = "free" | "pro";

export type MonitorStatus = "up" | "down" | "unknown";

export type HeartbeatStatus = "up" | "down";

export interface User {
  id: string;
  telegramId: string | null;
  email: string | null;
  plan: Plan;
  statusSlug: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Monitor {
  id: string;
  userId: string;
  url: string;
  name: string | null;
  method: string;
  intervalSec: number;
  timeoutMs: number;
  retries: number;
  status: MonitorStatus;
  lastCheckAt: number | null;
  lastResponseMs: number | null;
  isPublic: boolean;
  isPaused: boolean;
  /** epoch seconds until which alerts are muted; null = not muted */
  mutedUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Heartbeat {
  id: number;
  monitorId: string;
  status: HeartbeatStatus;
  statusCode: number | null;
  responseMs: number | null;
  message: string | null;
  createdAt: number;
}

export interface Incident {
  id: string;
  monitorId: string;
  startedAt: number;
  endedAt: number | null;
  cause: string | null;
}

/** Result of a single HTTP check. */
export interface CheckResult {
  status: HeartbeatStatus;
  statusCode: number | null;
  responseMs: number;
  message: string | null;
}
