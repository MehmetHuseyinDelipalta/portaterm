import { describe, expect, it } from "vitest";
import { asRecord, isRecord } from "./record";

describe("isRecord", () => {
  it("accepts non-null, non-array objects without restricting their prototype", () => {
    expect(isRecord({ key: "value" })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(new Date(0))).toBe(true);
  });

  it("rejects arrays, null, and primitives", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("value")).toBe(false);
    expect(isRecord(1)).toBe(false);
  });
});

describe("asRecord", () => {
  it("returns the same object and rejects arrays", () => {
    const value = { key: "value" };
    expect(asRecord(value)).toBe(value);
    expect(asRecord([])).toBeUndefined();
  });
});
