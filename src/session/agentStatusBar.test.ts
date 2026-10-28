import { describe, expect, it } from "vitest";
import { attentionTargets, summarizeAttention } from "./agentStatusBar";

const tabName = (id: string) => (id === "nameless" ? undefined : `Tab ${id}`);

describe("summarizeAttention", () => {
  it("shows nothing when no agent has anything to show", () => {
    expect(summarizeAttention({}, tabName)).toBeUndefined();
  });

  it("counts working, waiting and finished agents in that order", () => {
    const summary = summarizeAttention(
      {
        a: { state: "working", agent: "Claude" },
        b: { state: "approval", agent: "Claude" },
        c: { state: "working", agent: "Cursor Agent" },
        d: { state: "question", agent: "Claude" },
        e: { state: "unseen", agent: "Claude" },
      },
      tabName,
    );
    expect(summary?.text).toBe("$(sync~spin) 2 working · $(bell-dot) 2 waiting · $(check) 1 done");
    expect(summary?.urgent).toBe(true);
  });

  it("leaves out the counts that are zero and is not urgent without a waiting agent", () => {
    const summary = summarizeAttention({ a: { state: "working", agent: "Claude" } }, tabName);
    expect(summary?.text).toBe("$(sync~spin) 1 working");
    expect(summary?.urgent).toBe(false);
  });

  it("names each pane in the tooltip, most urgent first", () => {
    const summary = summarizeAttention(
      {
        a: { state: "working", agent: "Claude" },
        nameless: { state: "approval", agent: "Cursor Agent" },
      },
      tabName,
    );
    expect(summary?.tooltip.split("\n").slice(0, 2)).toEqual([
      "Terminal: Cursor Agent is waiting for your approval",
      "Tab a: Claude is working",
    ]);
  });
});

describe("attentionTargets", () => {
  it("puts blocked agents before finished ones before working ones", () => {
    const order = attentionTargets({
      a: { state: "working", agent: "Claude" },
      b: { state: "unseen", agent: "Claude" },
      c: { state: "question", agent: "Claude" },
      d: { state: "approval", agent: "Claude" },
    }).map((t) => t.paneId);
    expect(order).toEqual(["c", "d", "b", "a"]);
  });
});
