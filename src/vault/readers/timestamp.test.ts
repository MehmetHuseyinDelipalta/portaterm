import { describe, expect, it } from "vitest";
import {
  parseEpochMilliseconds,
  parseRfc3339Timestamp,
  parseStoredTimestamp,
  parseWorkflowStartTime,
} from "./timestamp";

const EPOCH = 1_750_000_000_000;

describe("timestamp store boundaries", () => {
  it("accepts finite integer epoch milliseconds only as numbers", () => {
    expect(parseEpochMilliseconds(EPOCH)).toBe(EPOCH);
    for (const value of [String(EPOCH), Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(parseEpochMilliseconds(value)).toBeUndefined();
    }
  });

  it("keeps RFC3339-only fields string-only", () => {
    expect(parseRfc3339Timestamp("2026-05-01T01:02:03Z")).toBe(Date.parse("2026-05-01T01:02:03Z"));
    expect(parseRfc3339Timestamp(EPOCH)).toBeUndefined();
  });

  it("rejects impossible RFC3339 calendar and clock values", () => {
    for (const value of [
      "2026-02-30T01:02:03Z",
      "2026-04-31T01:02:03Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T01:60:00Z",
      "2026-01-01T01:02:60Z",
    ]) {
      expect(parseRfc3339Timestamp(value)).toBeUndefined();
    }
    expect(parseRfc3339Timestamp("2024-02-29T23:59:59Z")).toBe(Date.parse("2024-02-29T23:59:59Z"));
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
