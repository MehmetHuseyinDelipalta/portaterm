import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AttentionPanes } from "./agentAttention";
import {
  type AgentPickEntry,
  type AgentStatusTarget,
  agentPickItems,
  attentionTargets,
  focusViewCommand,
  GO_TO_AGENT_COMMAND,
  type GoToAgentDeps,
  goToAgent,
  OPEN_COMMAND,
  planGoToAgent,
  summarizeAttention,
} from "./agentStatusBar";

const tabName = (id: string) => (id === "nameless" ? undefined : `Tab ${id}`);

describe("summarizeAttention", () => {
  it("shows the bare name, opening Portaterm, when no agent has anything to show", () => {
    expect(summarizeAttention({}, tabName)).toEqual({
      text: "Portaterm",
      tooltip: "Open Portaterm",
      urgent: false,
      command: OPEN_COMMAND,
    });
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
    expect(summary.text).toBe("Portaterm — $(sync~spin) 2 working · $(bell-dot) 2 waiting · $(check) 1 done");
    expect(summary.urgent).toBe(true);
    expect(summary.command).toBe(GO_TO_AGENT_COMMAND);
  });

  it("leaves out the counts that are zero and is not urgent without a waiting agent", () => {
    const summary = summarizeAttention({ a: { state: "working", agent: "Claude" } }, tabName);
    expect(summary.text).toBe("Portaterm — $(sync~spin) 1 working");
    expect(summary.urgent).toBe(false);
    expect(summary.command).toBe(GO_TO_AGENT_COMMAND);
  });

  it("names each pane in the tooltip, most urgent first", () => {
    const summary = summarizeAttention(
      {
        a: { state: "working", agent: "Claude" },
        nameless: { state: "approval", agent: "Cursor Agent" },
      },
      tabName,
    );
    expect(summary.tooltip.split("\n")).toEqual([
      "Terminal: Cursor Agent is waiting for your approval",
      "Tab a: Claude is working",
      "",
      "Click to pick an agent's tab or open Portaterm.",
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

describe("planGoToAgent", () => {
  it("opens Portaterm when no agent is counted", () => {
    expect(planGoToAgent([], tabName)).toEqual({ kind: "open" });
  });

  it("offers a pick even for a single agent, ending with a row that opens Portaterm", () => {
    const target = { paneId: "a", state: "unseen" as const, agent: "Claude" };
    expect(planGoToAgent([target], tabName)).toEqual({
      kind: "pick",
      entries: [
        { kind: "agent", label: "Tab a", description: "Claude · finished", target },
        { kind: "separator" },
        { kind: "open", label: "$(terminal) Open Portaterm" },
      ],
    });
  });

  it("lists the agents in the order given, naming a pane without a tab name Terminal", () => {
    const targets = attentionTargets({
      a: { state: "working", agent: "Claude" },
      nameless: { state: "approval", agent: "Cursor Agent" },
      c: { state: "working", agent: "Cursor Agent" },
    });
    const plan = planGoToAgent(targets, tabName);
    if (plan.kind !== "pick") {
      throw new Error("expected a pick");
    }
    expect(
      plan.entries.map((entry) => (entry.kind === "agent" ? `${entry.label} | ${entry.description}` : entry.kind)),
    ).toEqual([
      "Terminal | Cursor Agent · waiting for your approval",
      "Tab a | Claude · working",
      "Tab c | Cursor Agent · working",
      "separator",
      "open",
    ]);
  });

  it("carries each target through untouched, so a pick can focus it", () => {
    const target = { paneId: "a", state: "working" as const, agent: "Claude", viewId: "portaterm.panel" };
    const plan = planGoToAgent([target], tabName);
    expect(plan.kind === "pick" && plan.entries[0]?.kind === "agent" && plan.entries[0].target).toBe(target);
  });
});

describe("agentPickItems", () => {
  it("turns each entry into a quick pick row that carries it back", () => {
    const target = { paneId: "a", state: "working" as const, agent: "Claude" };
    const entries: AgentPickEntry<AgentStatusTarget>[] = [
      { kind: "agent", label: "Tab a", description: "Claude · working", target },
      { kind: "separator" },
      { kind: "open", label: "$(terminal) Open Portaterm" },
    ];
    expect(agentPickItems(entries, -1)).toEqual([
      { label: "Tab a", description: "Claude · working", entry: entries[0] },
      { label: "", kind: -1, entry: entries[1] },
      { label: "$(terminal) Open Portaterm", entry: entries[2] },
    ]);
  });
});

describe("goToAgent", () => {
  type Picked = AgentPickEntry<AgentStatusTarget & { viewId: string }>;

  function harness(
    panes: AttentionPanes,
    choose: (entries: Picked[]) => Picked | undefined,
    views: Record<string, string | undefined> = {},
  ) {
    const shown: Picked[][] = [];
    const deps: GoToAgentDeps<AgentStatusTarget> = {
      panes: () => panes,
      viewIdOf: (paneId) => (paneId in views ? views[paneId] : "portaterm.sidebar"),
      tabName,
      pick: async (entries) => {
        shown.push(entries);
        return choose(entries);
      },
      focusPane: vi.fn(async () => {}),
      open: vi.fn(async () => {}),
    };
    return { deps, shown };
  }

  it("opens Portaterm without a pick when no agent is counted", async () => {
    const h = harness({}, () => undefined);
    await goToAgent(h.deps);
    expect(h.shown).toEqual([]);
    expect(h.deps.open).toHaveBeenCalledTimes(1);
    expect(h.deps.focusPane).not.toHaveBeenCalled();
  });

  it("shows a pick for a single agent and focuses its pane in its own view when picked", async () => {
    const h = harness(
      { a: { state: "unseen", agent: "Claude" } },
      (entries) => entries.find((e) => e.kind === "agent"),
      { a: "portaterm.panel" },
    );
    await goToAgent(h.deps);
    expect(h.shown).toHaveLength(1);
    expect(h.deps.focusPane).toHaveBeenCalledWith("a", "portaterm.panel");
    expect(h.deps.open).not.toHaveBeenCalled();
  });

  it("goes to the agent picked, not the first one listed", async () => {
    const h = harness(
      {
        a: { state: "working", agent: "Claude" },
        b: { state: "approval", agent: "Claude" },
        c: { state: "working", agent: "Cursor Agent" },
      },
      (entries) => entries.find((e) => e.kind === "agent" && e.target.paneId === "c"),
    );
    await goToAgent(h.deps);
    expect(h.deps.focusPane).toHaveBeenCalledExactlyOnceWith("c", "portaterm.sidebar");
  });

  it("opens Portaterm from the pick's last row while agents are counted", async () => {
    const h = harness({ a: { state: "working", agent: "Claude" } }, (entries) => entries.at(-1));
    await goToAgent(h.deps);
    expect(h.shown[0]?.at(-1)).toEqual({ kind: "open", label: "$(terminal) Open Portaterm" });
    expect(h.deps.open).toHaveBeenCalledTimes(1);
    expect(h.deps.focusPane).not.toHaveBeenCalled();
  });

  it("does nothing when the pick is dismissed", async () => {
    const h = harness({ a: { state: "working", agent: "Claude" } }, () => undefined);
    await goToAgent(h.deps);
    expect(h.deps.open).not.toHaveBeenCalled();
    expect(h.deps.focusPane).not.toHaveBeenCalled();
  });

  it("does nothing when the separator comes back as the pick", async () => {
    const h = harness({ a: { state: "working", agent: "Claude" } }, (entries) =>
      entries.find((e) => e.kind === "separator"),
    );
    await goToAgent(h.deps);
    expect(h.deps.open).not.toHaveBeenCalled();
    expect(h.deps.focusPane).not.toHaveBeenCalled();
  });

  it("leaves out a pane no view can reveal, and opens Portaterm when that leaves none", async () => {
    const lost = harness({ a: { state: "approval", agent: "Claude" } }, () => undefined, { a: undefined });
    await goToAgent(lost.deps);
    expect(lost.shown).toEqual([]);
    expect(lost.deps.open).toHaveBeenCalledTimes(1);

    const mixed = harness(
      {
        a: { state: "approval", agent: "Claude" },
        b: { state: "working", agent: "Claude" },
      },
      () => undefined,
      { a: undefined },
    );
    await goToAgent(mixed.deps);
    expect(mixed.shown[0]?.flatMap((e) => (e.kind === "agent" ? [e.target.paneId] : []))).toEqual(["b"]);
  });
});

describe("the commands the entry runs", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")) as {
    contributes: { commands: { command: string }[]; views: Record<string, { id: string }[]> };
  };

  it("focuses a view Portaterm contributes, sidebar and panel alike", () => {
    const viewIds = Object.values(manifest.contributes.views)
      .flat()
      .map((view) => view.id);
    expect(viewIds).toEqual(expect.arrayContaining(["portaterm.sidebar", "portaterm.panel"]));
    for (const viewId of viewIds) {
      expect(focusViewCommand(viewId)).toBe(`${viewId}.focus`);
    }
  });

  it("offers the pick of agents in the command palette", () => {
    expect(manifest.contributes.commands.map((c) => c.command)).toContain(GO_TO_AGENT_COMMAND);
  });
});
