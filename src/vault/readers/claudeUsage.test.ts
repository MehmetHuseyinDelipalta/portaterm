import { describe, expect, it } from "vitest";
import { createClaudeUsageCollector } from "./claudeUsage";

type Rec = Record<string, unknown>;

function assistant(usage: Rec, opts: { id?: string; requestId?: string; model?: string } = {}): Rec {
  return {
    type: "assistant",
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
    message: {
      role: "assistant",
      ...(opts.id ? { id: opts.id } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      content: [],
      usage,
    },
  };
}

function costState(modelUsage: Rec, extra: Rec = {}): Rec {
  return { type: "cost-state", sessionId: "s", modelUsage, ...extra };
}

function collect(records: Rec[], opts?: { wholeSession?: boolean }) {
  const c = createClaudeUsageCollector(opts);
  for (const r of records) {
    c.onRecord(r);
  }
  return c.result();
}

const opusUsage = {
  input_tokens: 2,
  cache_read_input_tokens: 300,
  cache_creation_input_tokens: 40,
  output_tokens: 5,
};

describe("createClaudeUsageCollector — summed from assistant records", () => {
  it("sums each response's usage into its model's four counts", () => {
    const usage = collect([
      assistant(opusUsage, { id: "a", model: "claude-opus-5-5" }),
      assistant(opusUsage, { id: "b", model: "claude-opus-5-5" }),
      assistant({ input_tokens: 7, output_tokens: 1 }, { id: "c", model: "claude-haiku-5-5" }),
    ]);
    expect(usage).toEqual({
      models: [
        { model: "claude-opus-5-5", input: 4, cacheRead: 600, cacheWrite: 80, output: 10 },
        { model: "claude-haiku-5-5", input: 7, cacheRead: 0, cacheWrite: 0, output: 1 },
      ],
      includesSubagents: false,
    });
  });

  it("counts a response split over several records once, by message id", () => {
    const usage = collect([
      assistant(opusUsage, { id: "same", model: "m" }),
      assistant(opusUsage, { id: "same", model: "m" }),
      assistant(opusUsage, { id: "same", model: "m" }),
    ]);
    expect(usage?.models[0]).toMatchObject({ input: 2, cacheRead: 300, cacheWrite: 40, output: 5 });
  });

  it("falls back to the requestId when the message has no id", () => {
    const usage = collect([
      assistant(opusUsage, { requestId: "r1", model: "m" }),
      assistant(opusUsage, { requestId: "r1", model: "m" }),
      assistant(opusUsage, { requestId: "r2", model: "m" }),
    ]);
    expect(usage?.models[0].output).toBe(10);
  });

  it("counts every record when neither id exists", () => {
    const usage = collect([assistant(opusUsage, { model: "m" }), assistant(opusUsage, { model: "m" })]);
    expect(usage?.models[0].output).toBe(10);
  });

  it("buckets a record with no model string without a model name", () => {
    const usage = collect([assistant({ input_tokens: 3 }, { id: "x" })]);
    expect(usage?.models).toEqual([{ input: 3, cacheRead: 0, cacheWrite: 0, output: 0 }]);
  });

  it("ignores user records, assistant records without usage, and non-numeric counts", () => {
    const usage = collect([
      { type: "user", message: { role: "user", content: "hi", usage: opusUsage } },
      { type: "assistant", message: { role: "assistant", content: [] } },
      { type: "assistant" },
      assistant({ input_tokens: "12", output_tokens: Number.NaN, cache_read_input_tokens: 4 }, { id: "z", model: "m" }),
    ]);
    expect(usage?.models).toEqual([{ model: "m", input: 0, cacheRead: 4, cacheWrite: 0, output: 0 }]);
  });

  it("is undefined when no record carries usage", () => {
    expect(collect([{ type: "user", message: { content: "hi" } }])).toBeUndefined();
  });
});

describe("createClaudeUsageCollector — Claude's cost-state", () => {
  const opusState = {
    inputTokens: 132,
    outputTokens: 13564,
    cacheReadInputTokens: 1223107,
    cacheCreationInputTokens: 61223,
    thinkingTokens: 1025,
    costUSD: 1.0062134,
  };

  it("wins over the summed records, with Claude's cost, and counts subagents", () => {
    const usage = collect([
      assistant(opusUsage, { id: "a", model: "claude-opus-5-5" }),
      costState({
        "claude-opus-5-5": opusState,
        "claude-haiku-5-5": { inputTokens: 2060, outputTokens: 227, costUSD: 0.0003195 },
      }),
    ]);
    expect(usage).toEqual({
      models: [
        {
          model: "claude-opus-5-5",
          input: 132,
          cacheRead: 1223107,
          cacheWrite: 61223,
          output: 13564,
          costUSD: 1.0062134,
        },
        { model: "claude-haiku-5-5", input: 2060, cacheRead: 0, cacheWrite: 0, output: 227, costUSD: 0.0003195 },
      ],
      costUSD: 1.0062134 + 0.0003195,
      includesSubagents: true,
    });
  });

  it("takes the latest cost-state — each one is the running total", () => {
    const usage = collect([
      costState({ m: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } }),
      costState({ m: { inputTokens: 5, outputTokens: 5, costUSD: 0.5 } }),
    ]);
    expect(usage?.models).toEqual([{ model: "m", input: 5, cacheRead: 0, cacheWrite: 0, output: 5, costUSD: 0.5 }]);
  });

  it("keeps the tokens but drops every cost when Claude had no price for some model", () => {
    const usage = collect([
      costState(
        {
          known: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 },
          unknown: { inputTokens: 9, outputTokens: 0, costUSD: 0 },
        },
        { hasUnknownModelCost: true },
      ),
    ]);
    expect(usage).not.toHaveProperty("costUSD");
    expect(usage?.models.every((m) => m.costUSD === undefined)).toBe(true);
    expect(usage?.models).toHaveLength(2);
  });

  it("leaves out a model whose cost is not a finite number, keeping its tokens", () => {
    const usage = collect([costState({ m: { inputTokens: 4, outputTokens: 0, costUSD: "1" } })]);
    expect(usage?.models).toEqual([{ model: "m", input: 4, cacheRead: 0, cacheWrite: 0, output: 0 }]);
    expect(usage).not.toHaveProperty("costUSD");
  });

  it("skips a model entry that is not an object", () => {
    const usage = collect([costState({ broken: 7, m: { inputTokens: 1, outputTokens: 0, costUSD: 0.01 } })]);
    expect(usage?.models.map((m) => m.model)).toEqual(["m"]);
  });

  it("ignores a cost-state without a modelUsage object", () => {
    const usage = collect([assistant(opusUsage, { id: "a", model: "m" }), { type: "cost-state", modelUsage: null }]);
    expect(usage?.includesSubagents).toBe(false);
    expect(usage?.models[0].output).toBe(5);
  });

  it("falls back to the summed records when the cost-state counts nothing", () => {
    const usage = collect([assistant(opusUsage, { id: "a", model: "m" }), costState({})]);
    expect(usage?.includesSubagents).toBe(false);
    expect(usage?.models[0].output).toBe(5);
  });

  it("ignores cost-state for a slice of a transcript, which it would overstate", () => {
    const usage = collect(
      [assistant(opusUsage, { id: "a", model: "m" }), costState({ m: { inputTokens: 999, costUSD: 9 } })],
      { wholeSession: false },
    );
    expect(usage).toEqual({
      models: [{ model: "m", input: 2, cacheRead: 300, cacheWrite: 40, output: 5 }],
      includesSubagents: false,
    });
  });
});
