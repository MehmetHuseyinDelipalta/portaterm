// The order, not the rule — `killConfirmation.test.ts` owns the rule. What is
// asserted here is what round 1 found: the id that was weighed is the id that
// is destroyed, and a decline destroys nothing.

import { describe, expect, it } from "vitest";
import { type CloseGateDeps, closePaneGated, disposalGrace, killTerminalGated } from "./closeGates";

const AGENT = { exited: false, isAgentLaunch: true, shell: "claude" };
const SHELL = { exited: false, isAgentLaunch: false, shell: "zsh" };

function gates(
  panes: Record<string, typeof AGENT | typeof SHELL>,
  answer: string | undefined,
  tabs: Record<string, string[]> = {},
  splits: readonly string[] = [],
) {
  const asked: string[] = [];
  const destroyed: string[] = [];
  const tabRemoved: string[] = [];
  const paneClosed: string[] = [];
  const deps: CloseGateDeps = {
    evidence: { read: (id) => panes[id] },
    ui: {
      showWarningMessage: (message, options) => {
        asked.push(`${message}${options.detail ?? ""}`);
        return Promise.resolve(answer);
      },
    },
    panesOfTab: (tabId) => tabs[tabId] ?? [tabId],
    isSplitPane: (sessionId) => splits.includes(sessionId),
    destroySession: (id) => destroyed.push(id),
    postTabRemoved: (id) => tabRemoved.push(id),
    postClosePane: (id) => paneClosed.push(id),
  };
  return { deps, asked, destroyed, tabRemoved, paneClosed };
}

describe("killTerminalGated", () => {
  it("destroys and tears down the id it was given, once confirmed", async () => {
    const g = gates({ t1: AGENT }, "Kill Terminal");
    await expect(killTerminalGated("t1", g.deps)).resolves.toBe(true);
    expect(g.destroyed).toEqual(["t1"]);
    expect(g.tabRemoved).toEqual(["t1"]);
  });

  it("destroys nothing when the user declines", async () => {
    const g = gates({ t1: AGENT }, undefined);
    await expect(killTerminalGated("t1", g.deps)).resolves.toBe(false);
    expect(g.destroyed).toEqual([]);
    expect(g.tabRemoved).toEqual([]);
  });

  it("asks nothing for an ordinary shell", async () => {
    const g = gates({ t1: SHELL }, undefined);
    await expect(killTerminalGated("t1", g.deps)).resolves.toBe(true);
    expect(g.asked).toEqual([]);
    expect(g.destroyed).toEqual(["t1"]);
  });

  it("weighs the tab's split panes, not just the tab", async () => {
    // The tab's own pane is idle; the agent is in the split beside it, which
    // this kill takes down too.
    const g = gates({ t1: SHELL, p2: AGENT }, undefined, { t1: ["t1", "p2"] });
    await expect(killTerminalGated("t1", g.deps)).resolves.toBe(false);
    expect(g.asked[0]).toContain("claude is still running here");
    // Non-vacuous: weighing the tab id alone would have found nothing and let
    // the kill through with no question at all.
    const alone = gates({ t1: SHELL, p2: AGENT }, undefined);
    await expect(killTerminalGated("t1", alone.deps)).resolves.toBe(true);
    expect(alone.asked).toEqual([]);
  });

  it("falls back to the id itself when the host knows no such tab", async () => {
    // `panesOfTab` answers `[]` for an unknown tab; weighing nothing would make
    // every such kill silent.
    const g = gates({ t1: AGENT }, undefined, { t1: [] });
    await expect(killTerminalGated("t1", g.deps)).resolves.toBe(false);
    expect(g.asked).toHaveLength(1);
  });
});

describe("killTerminalGated on a focused split", () => {
  it("uses the pane protocol, not the tab one", async () => {
    // `tabRemoved` runs the webview's ROOT-tab teardown, which would leave the
    // split leaf and its layout standing (round-2 F008).
    const g = gates({ p2: AGENT }, "Close Pane", { p2: ["p2"] }, ["p2"]);
    await expect(killTerminalGated("p2", g.deps)).resolves.toBe(true);
    expect(g.paneClosed).toEqual(["p2"]);
    expect(g.tabRemoved).toEqual([]);
    expect(g.destroyed).toEqual([]);
  });

  it("weighs only the split, not its siblings", async () => {
    // Killing one leaf leaves the others alone, so an agent beside it is not
    // this gesture's business.
    const g = gates({ p2: SHELL, p3: AGENT }, undefined, { p2: ["p2", "p3"] }, ["p2"]);
    await expect(killTerminalGated("p2", g.deps)).resolves.toBe(true);
    expect(g.asked).toEqual([]);
    // Non-vacuous: the same id as a ROOT weighs the whole tab and does ask.
    const asRoot = gates({ p2: SHELL, p3: AGENT }, undefined, { p2: ["p2", "p3"] });
    await expect(killTerminalGated("p2", asRoot.deps)).resolves.toBe(false);
    expect(asRoot.asked).toHaveLength(1);
  });
});

describe("closePaneGated", () => {
  it("closes the pane it weighed, by id", async () => {
    const g = gates({ p2: AGENT }, "Close Pane");
    await expect(closePaneGated("p2", g.deps)).resolves.toBe(true);
    expect(g.paneClosed).toEqual(["p2"]);
  });

  it("closes nothing when the user declines", async () => {
    const g = gates({ p2: AGENT }, undefined);
    await expect(closePaneGated("p2", g.deps)).resolves.toBe(false);
    expect(g.paneClosed).toEqual([]);
  });

  it("weighs only the named pane, not the tab it sits in", async () => {
    // Closing one split pane leaves its siblings alone, so an agent in a
    // sibling is not this gesture's business.
    const g = gates({ p2: SHELL, p3: AGENT }, undefined, { p2: ["p2", "p3"] });
    await expect(closePaneGated("p2", g.deps)).resolves.toBe(true);
    expect(g.asked).toEqual([]);
    expect(g.paneClosed).toEqual(["p2"]);
  });
});

describe("disposalGrace", () => {
  const MS = { idle: 5_000, agents: 30_000 };

  it("leaves the ordinary grace alone when nothing is running", () => {
    // Lengthening it for every closed tab would hold ptys for no reason.
    const g = disposalGrace(["t1"], { read: () => SHELL }, MS);
    expect(g).toEqual({ graceMs: 5_000, running: [] });
  });

  it("lengthens it and names what is at stake when an agent is", () => {
    const g = disposalGrace(["t1"], { read: () => AGENT }, MS);
    expect(g.graceMs).toBe(30_000);
    expect(g.running).toEqual([{ sessionId: "t1", name: "claude" }]);
  });

  it("weighs every session in the view, not just the first", () => {
    // Closing the editor tab kills them all, so one live agent anywhere in it
    // is enough to earn the undo window.
    const panes: Record<string, typeof AGENT | typeof SHELL> = { a: SHELL, b: AGENT };
    const g = disposalGrace(["a", "b"], { read: (id) => panes[id] }, MS);
    expect(g.graceMs).toBe(30_000);
    expect(g.running.map((p) => p.sessionId)).toEqual(["b"]);
  });
});
