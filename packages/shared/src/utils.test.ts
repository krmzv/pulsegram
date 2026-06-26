import { describe, expect, test } from "bun:test";
import { formatDuration, formatUptime, nameFromUrl, uptimePercent } from "./utils";

describe("uptimePercent", () => {
  test("null with no data", () => expect(uptimePercent([])).toBeNull());
  test("100% all up", () =>
    expect(uptimePercent([{ status: "up" }, { status: "up" }])).toBe(100));
  test("50% half down", () =>
    expect(uptimePercent([{ status: "up" }, { status: "down" }])).toBe(50));
});

describe("formatUptime", () => {
  test("dash for null", () => expect(formatUptime(null)).toBe("—"));
  test("100%", () => expect(formatUptime(100)).toBe("100%"));
  test("two decimals", () => expect(formatUptime(99.9389)).toBe("99.94%"));
});

describe("formatDuration", () => {
  test("seconds", () => expect(formatDuration(45)).toBe("45s"));
  test("minutes + seconds", () => expect(formatDuration(222)).toBe("3m 42s"));
  test("exact minutes", () => expect(formatDuration(120)).toBe("2m"));
  test("hours", () => expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h 5m"));
  test("days", () => expect(formatDuration(2 * 86400 + 3600)).toBe("2d 1h"));
});

describe("nameFromUrl", () => {
  test("extracts hostname", () =>
    expect(nameFromUrl("https://api.example.com/health")).toBe("api.example.com"));
});
