import { describe, expect, it } from "vitest";
import { parseEpochMilliseconds, parseStoredTimestamp, parseWorkflowStartTime } from "./timestamp";

const EPOCH = 1_750_000_000_000;

describe("timestamp store boundaries", () => {
  it("accepts finite integer epoch milliseconds only as numbers", () => {
    expect(parseEpochMilliseconds(EPOCH)).toBe(EPOCH);
    for (const value of [String(EPOCH), Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(parseEpochMilliseconds(value)).toBeUndefined();
    }
  });

  it("accepts RFC3339 transcript strings and numeric epoch milliseconds", () => {
    expect(parseStoredTimestamp("2026-05-01T01:02:03Z")).toBe(Date.parse("2026-05-01T01:02:03Z"));
    expect(parseStoredTimestamp("2026-05-01T01:02:03.456+07:00")).toBe(Date.parse("2026-05-01T01:02:03.456+07:00"));
    expect(parseStoredTimestamp(EPOCH)).toBe(EPOCH);
  });

  it("does not reinterpret loose numeric or date-like strings", () => {
    for (const value of [String(EPOCH), "2026", "1", "1e3", "0x10", `+${EPOCH}`, ` ${EPOCH} `, `${EPOCH}.5`, ""]) {
      expect(parseStoredTimestamp(value)).toBeUndefined();
    }
  });

  it("keeps decimal epoch strings as workflow-start compatibility only", () => {
    expect(parseWorkflowStartTime(EPOCH)).toBe(EPOCH);
    expect(parseWorkflowStartTime(String(EPOCH))).toBe(EPOCH);
    for (const value of ["1e3", "0x10", `+${EPOCH}`, ` ${EPOCH} `, `${EPOCH}.5`, "0000000000001"]) {
      expect(parseWorkflowStartTime(value)).toBeUndefined();
    }
  });
});
