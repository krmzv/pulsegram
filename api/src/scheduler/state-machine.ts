import type { HeartbeatStatus, MonitorStatus } from "@pulsegram/shared";

/** What the scheduler should do after a single check result. */
export type Transition =
  | "stay-up" // up/unknown → up: nothing to announce
  | "recovered" // down → up: close incident, send 🟢
  | "pending-down" // failing but below the retry threshold: keep status, wait
  | "went-down" // threshold reached: open incident, send 🔴
  | "stay-down"; // already down, still down: nothing new

/**
 * Pure state-machine decision. `failCount` is the consecutive-failure count
 * AFTER incorporating the current result (i.e. already incremented on a fail).
 */
export function decide(
  prev: MonitorStatus,
  check: HeartbeatStatus,
  failCount: number,
  retries: number,
): Transition {
  if (check === "up") {
    return prev === "down" ? "recovered" : "stay-up";
  }
  if (prev === "down") return "stay-down";
  return failCount >= retries ? "went-down" : "pending-down";
}
