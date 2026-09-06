import { describe, expect, it } from "vitest";
import { registrySessionActivity } from "./registrySessionActivity";

describe("registrySessionActivity", () => {
  it.each([
    ["busy", "running"],
    ["waiting", "waiting"],
    ["idle", "idle"],
    [undefined, undefined],
    ["paused", undefined],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(registrySessionActivity(status)).toBe(expected);
  });
});
