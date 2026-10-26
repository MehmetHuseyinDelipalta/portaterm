import { describe, expect, it, vi } from "vitest";
import type { AgentTurnReport } from "../agentHooks/AgentHookRuntime";
import { type AgentAttentionDeps, attentionPhaseOf, createAgentAttention, GO_TO_TAB } from "./agentAttention";
import { type PaneEvidence, TURN_FRESHNESS_MS } from "./PaneEvidenceStore";

const NOW = 1_000_000;

function turn(state: AgentTurnReport["state"], extra: Partial<AgentTurnReport> = {}): PaneEvidence["turn"] {
  return { report: { state, stateStartedAt: NOW, subagents: [], ...extra }, receivedAt: NOW };
}

function harness(overrides: Partial<AgentAttentionDeps> = {}) {
  const panes = new Map<string, PaneEvidence>();
  const notify = vi.fn<AgentAttentionDeps["notify"]>(() => Promise.resolve(undefined));
  const focusPane = vi.fn();
  const setBadge = vi.fn();
  const publish = vi.fn<AgentAttentionDeps["publish"]>();
  const settings = { enabled: true, onTurnEnd: true };
  const visible = new Set<string>();
  const attention = createAgentAttention({
    readPane: (id) => panes.get(id),
    panes: () => [...panes].map(([paneId, e]) => ({ paneId, ...e })),
    tabName: (id) => `Tab ${id}`,
    isPaneVisible: (id) => visible.has(id),
    readSettings: () => settings,
    notify,
    focusPane,
    setBadge,
    badgeViews: ["sidebar", "panel"],
    publish,
    now: () => NOW,
    ...overrides,
  });
  function set(id: string, evidence: Partial<PaneEvidence>) {
    panes.set(id, { exited: false, viewId: "sidebar", ...evidence });
    attention.update(id);
  }
  return { attention, panes, notify, focusPane, setBadge, publish, settings, visible, set };
}

describe("attentionPhaseOf", () => {
  it("ranks screen-detected waiting above a turn", () => {
    expect(attentionPhaseOf({ exited: false, waiting: true, turn: turn("working") }, NOW)).toEqual({
      phase: "approval",
      agent: "Cursor Agent",
    });
  });

  it("separates a Claude question from an approval", () => {
    const asking = turn("waiting", { interactivePrompt: '{"questions":[]}' });
    expect(attentionPhaseOf({ exited: false, turn: asking }, NOW).phase).toBe("question");
    expect(attentionPhaseOf({ exited: false, turn: turn("waiting") }, NOW).phase).toBe("approval");
  });

  it("ignores a stale turn and falls back to Cursor's semantic word", () => {
    const stale = { exited: false, semantic: "idle" as const, turn: turn("working") };
    expect(attentionPhaseOf(stale, NOW + TURN_FRESHNESS_MS)).toEqual({ phase: "done", agent: "Cursor Agent" });
  });

  it("holds a Claude wait past the freshness window until it is answered", () => {
    const waiting = { exited: false, turn: turn("waiting") };
    expect(attentionPhaseOf(waiting, NOW + 10 * TURN_FRESHNESS_MS).phase).toBe("approval");
    expect(attentionPhaseOf(waiting, NOW, true)).toEqual({ phase: "working", agent: "Claude" });
    expect(attentionPhaseOf(waiting, NOW + TURN_FRESHNESS_MS, true).phase).toBe("none");
  });

  it("does not treat a session boundary or an interrupt as a finished turn", () => {
    expect(attentionPhaseOf({ exited: false, turn: turn("done", { sessionBoundary: true }) }, NOW).phase).toBe("none");
    expect(attentionPhaseOf({ exited: false, turn: turn("done", { interrupted: true }) }, NOW).phase).toBe("none");
  });

  it("reports nothing for an exited pane", () => {
    expect(attentionPhaseOf({ exited: true, waiting: true }, NOW).phase).toBe("none");
  });
});

describe("createAgentAttention marks", () => {
  it("publishes a waiting pane, and only when the set changed", () => {
    const h = harness();
    h.set("a", { turn: turn("waiting") });
    expect(h.publish).toHaveBeenLastCalledWith({ a: { state: "approval", agent: "Claude" } });
    h.set("a", { turn: turn("waiting") });
    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  it("clears a Claude wait once the user types into the pane", () => {
    const h = harness();
    h.set("a", { turn: turn("waiting") });
    h.attention.paneInput("a");
    expect(h.publish).toHaveBeenLastCalledWith({ a: { state: "working", agent: "Claude" } });
    h.attention.paneInput("a");
    expect(h.publish).toHaveBeenCalledTimes(2);
    h.set("a", { turn: { ...turn("waiting")!, receivedAt: NOW + 1 } });
    expect(h.publish).toHaveBeenLastCalledWith({ a: { state: "approval", agent: "Claude" } });
  });

  it("marks a turn that finished out of sight as unseen until its tab is seen", () => {
    const h = harness();
    h.set("a", { turn: turn("working") });
    h.set("a", { turn: turn("done") });
    expect(h.publish).toHaveBeenLastCalledWith({ a: { state: "unseen", agent: "Claude" } });
    h.attention.displayChanged();
    expect(h.publish).toHaveBeenCalledTimes(2);
    h.visible.add("a");
    h.attention.displayChanged();
    expect(h.publish).toHaveBeenLastCalledWith({});
  });

  it("does not mark a turn the user watched finish", () => {
    const h = harness();
    h.visible.add("a");
    h.set("a", { turn: turn("working") });
    h.set("a", { turn: turn("done") });
    expect(h.attention.snapshot()).toEqual({});
  });

  it("lets a new turn supersede an unseen one, and forgets an exited pane", () => {
    const h = harness();
    h.set("a", { semantic: "working" });
    h.set("a", { semantic: "idle" });
    expect(h.attention.snapshot()).toEqual({ a: { state: "unseen", agent: "Cursor Agent" } });
    h.set("a", { semantic: "working" });
    expect(h.attention.snapshot()).toEqual({ a: { state: "working", agent: "Cursor Agent" } });
    h.set("a", { semantic: "idle" });
    h.set("a", { exited: true });
    expect(h.attention.snapshot()).toEqual({});
  });

  it("publishes a working agent, and drops it once its turn ends in sight", () => {
    const h = harness();
    h.visible.add("a");
    h.set("a", { turn: turn("working") });
    expect(h.publish).toHaveBeenLastCalledWith({ a: { state: "working", agent: "Claude" } });
    h.set("a", { turn: turn("done") });
    expect(h.publish).toHaveBeenLastCalledWith({});
  });

  it("badges waiting panes even with notifications off, and never counts unseen or working ones", () => {
    const h = harness();
    h.settings.enabled = false;
    h.set("a", { turn: turn("waiting") });
    h.set("b", { turn: turn("working") });
    h.set("c", { semantic: "working" });
    h.set("b", { turn: turn("done") });
    expect(h.setBadge).toHaveBeenCalledWith("sidebar", ["Tab a"]);
    expect(h.setBadge).not.toHaveBeenCalledWith("sidebar", ["Tab a", "Tab b"]);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("createAgentAttention notifications", () => {
  it("notifies once when a hidden pane starts waiting, and focuses it on Go to Tab", async () => {
    const h = harness();
    h.notify.mockResolvedValueOnce(GO_TO_TAB);
    h.set("a", { turn: turn("waiting") });
    h.set("a", { turn: turn("waiting") });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith("Tab a: Claude is waiting for your approval", GO_TO_TAB);
    await vi.waitFor(() => expect(h.focusPane).toHaveBeenCalledWith("a", "sidebar"));
  });

  it("stays quiet for a pane the user is looking at", () => {
    const h = harness();
    h.visible.add("a");
    h.set("a", { waiting: true });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("announces a finished turn only after a turn was seen working", () => {
    const h = harness();
    h.set("a", { semantic: "idle" });
    expect(h.notify).not.toHaveBeenCalled();
    h.set("a", { semantic: "working" });
    h.set("a", { semantic: "idle" });
    expect(h.notify).toHaveBeenCalledWith("Tab a: Cursor Agent finished and is waiting for you", GO_TO_TAB);
  });

  it("announces the end of a turn that outlived its report's freshness", () => {
    let now = NOW;
    const h = harness({ now: () => now });
    h.set("a", { turn: turn("working") });
    now += TURN_FRESHNESS_MS;
    h.attention.update("a");
    h.set("a", { turn: { report: { state: "done", stateStartedAt: now, subagents: [] }, receivedAt: now } });
    expect(h.notify).toHaveBeenCalledWith("Tab a: Claude finished and is waiting for you", GO_TO_TAB);
  });

  it("skips the turn-end notification when onTurnEnd is off", () => {
    const h = harness();
    h.settings.onTurnEnd = false;
    h.set("a", { turn: turn("working") });
    h.set("a", { turn: turn("done") });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("stops notifying once disabled", () => {
    const h = harness();
    h.set("a", { waiting: true });
    h.settings.enabled = false;
    h.set("b", { waiting: true });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("counts waiting panes per view and only reports a badge that changed", () => {
    const h = harness();
    h.set("a", { waiting: true });
    h.set("b", { waiting: true, viewId: "panel" });
    h.set("c", { turn: turn("waiting") });
    expect(h.setBadge).toHaveBeenCalledWith("sidebar", ["Tab a", "Tab c"]);
    expect(h.setBadge).toHaveBeenCalledWith("panel", ["Tab b"]);
    const calls = h.setBadge.mock.calls.length;
    h.attention.update("c");
    expect(h.setBadge.mock.calls.length).toBe(calls);
    h.panes.delete("a");
    h.attention.update("a");
    expect(h.setBadge).toHaveBeenLastCalledWith("sidebar", ["Tab c"]);
  });

  it("leaves a waiting pane its view holds no tab for out of the badge, and reports it once", () => {
    const reportUnreachable = vi.fn();
    const h = harness({ reportUnreachable });
    h.set("a", { turn: turn("waiting") });
    h.set("ghost", { turn: turn("waiting") });
    expect(h.setBadge).toHaveBeenLastCalledWith("sidebar", ["Tab a", "Tab ghost"]);
    h.attention.panesPresented("sidebar", new Set(["a"]));
    expect(h.setBadge).toHaveBeenLastCalledWith("sidebar", ["Tab a"]);
    h.attention.update("ghost");
    expect(reportUnreachable).toHaveBeenCalledTimes(1);
    expect(reportUnreachable).toHaveBeenCalledWith("ghost", "sidebar");
  });

  it("counts every pane again once a view's webview stops saying which it holds", () => {
    const h = harness();
    h.set("a", { turn: turn("waiting") });
    h.attention.panesPresented("sidebar", new Set());
    expect(h.setBadge).toHaveBeenLastCalledWith("sidebar", []);
    h.attention.panesPresented("sidebar", undefined);
    expect(h.setBadge).toHaveBeenLastCalledWith("sidebar", ["Tab a"]);
  });
});
