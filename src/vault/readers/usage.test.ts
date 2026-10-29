import { describe, expect, it } from "vitest";
import { createUsageTally, sessionUsageTotal, usageCountsTotal, usageStats } from "./usage";

const counts = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
  input,
  cacheRead,
  cacheWrite,
  output,
});

describe("createUsageTally", () => {
  it("merges every add for one model into a single row", () => {
    const tally = createUsageTally();
    tally.add("m", counts(1, 2, 3, 4));
    tally.add("m", counts(10, 20, 30, 40));
    expect(tally.result(false)).toEqual({
      models: [{ model: "m", input: 11, cacheRead: 22, cacheWrite: 33, output: 44 }],
      includesSubagents: false,
    });
  });

  it("keeps an unattributed bucket with no model key", () => {
    const tally = createUsageTally();
    tally.add(undefined, counts(5, 0, 0, 5));
    const usage = tally.result(true);
    expect(usage?.models).toEqual([{ input: 5, cacheRead: 0, cacheWrite: 0, output: 5 }]);
    expect(usage?.models[0]).not.toHaveProperty("model");
    expect(usage?.includesSubagents).toBe(true);
  });

  it("orders models by total, largest first, and drops ones that used nothing", () => {
    const tally = createUsageTally();
    tally.add("small", counts(1, 0, 0, 1));
    tally.add("empty", counts(0, 0, 0, 0));
    tally.add("big", counts(0, 100, 0, 0));
    expect(tally.result(false)?.models.map((m) => m.model)).toEqual(["big", "small"]);
  });

  it("is undefined when no model used a token", () => {
    const tally = createUsageTally();
    expect(tally.result(false)).toBeUndefined();
    tally.add("m", counts(0, 0, 0, 0), 0);
    expect(tally.result(false)).toBeUndefined();
  });

  it("sums cost per model and across models, only over models that carry one", () => {
    const tally = createUsageTally();
    tally.add("a", counts(1, 0, 0, 0), 0.5);
    tally.add("a", counts(1, 0, 0, 0), 0.25);
    tally.add("b", counts(1, 0, 0, 0));
    const usage = tally.result(false);
    expect(usage?.models.find((m) => m.model === "a")?.costUSD).toBe(0.75);
    expect(usage?.models.find((m) => m.model === "b")).not.toHaveProperty("costUSD");
    expect(usage?.costUSD).toBe(0.75);
  });

  it("carries no session cost when no model has one", () => {
    const tally = createUsageTally();
    tally.add("a", counts(1, 0, 0, 0));
    expect(tally.result(false)).not.toHaveProperty("costUSD");
  });
});

describe("totals", () => {
  it("adds the four disjoint counts, per model and per session", () => {
    expect(usageCountsTotal(counts(1, 2, 3, 4))).toBe(10);
    expect(
      sessionUsageTotal({
        models: [
          { model: "a", ...counts(1, 2, 3, 4) },
          { model: "b", ...counts(10, 0, 0, 0) },
        ],
        includesSubagents: false,
      }),
    ).toBe(20);
  });

  it("turns usage into the stats' tokenCount + usage, and nothing into nothing", () => {
    const usage = { models: [{ model: "a", ...counts(1, 2, 3, 4) }], includesSubagents: false };
    expect(usageStats(usage)).toEqual({ tokenCount: 10, usage });
    expect(usageStats(undefined)).toEqual({});
  });
});
