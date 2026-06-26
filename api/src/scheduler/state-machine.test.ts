import { describe, expect, test } from "bun:test";
import { decide } from "./state-machine";

describe("state machine: decide()", () => {
  test("up→up = stay-up", () => expect(decide("up", "up", 0, 3)).toBe("stay-up"));
  test("unknown→up = stay-up", () => expect(decide("unknown", "up", 0, 3)).toBe("stay-up"));
  test("down→up = recovered", () => expect(decide("down", "up", 0, 3)).toBe("recovered"));

  test("up→fail below threshold = pending-down", () =>
    expect(decide("up", "down", 1, 3)).toBe("pending-down"));
  test("up→fail below threshold = pending-down (2)", () =>
    expect(decide("up", "down", 2, 3)).toBe("pending-down"));
  test("up→fail at threshold = went-down", () =>
    expect(decide("up", "down", 3, 3)).toBe("went-down"));
  test("up→fail above threshold = went-down", () =>
    expect(decide("up", "down", 5, 3)).toBe("went-down"));

  test("unknown→fail below threshold = pending-down", () =>
    expect(decide("unknown", "down", 2, 3)).toBe("pending-down"));
  test("unknown→fail at threshold = went-down", () =>
    expect(decide("unknown", "down", 3, 3)).toBe("went-down"));

  test("down→fail = stay-down (no duplicate alerts)", () =>
    expect(decide("down", "down", 99, 3)).toBe("stay-down"));
});
