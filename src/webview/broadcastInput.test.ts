// src/webview/broadcastInput.test.ts — who hears a keystroke while a tab broadcasts.

import { describe, expect, it, vi } from "vitest";
import { applyBroadcastCommand, BroadcastInput, SINGLE_PANE_NOTICE } from "./broadcastInput";
import { createBranch, createLeaf, type SplitNode } from "./SplitModel";

function setup(layouts: Record<string, SplitNode>, exited: string[] = []) {
  const tabLayouts = new Map(Object.entries(layouts));
  const terminals = new Map<string, { exited: boolean }>();
  for (const layout of tabLayouts.values()) {
    const walk = (node: SplitNode): void => {
      if (node.type === "leaf") {
        terminals.set(node.sessionId, { exited: exited.includes(node.sessionId) });
      } else {
        walk(node.children[0]);
        walk(node.children[1]);
      }
    };
    walk(layout);
  }
  const postMessage = vi.fn();
  const broadcast = new BroadcastInput({ store: { tabLayouts, terminals }, postMessage });
  const sentTo = () => postMessage.mock.calls.map(([msg]) => (msg as { tabId: string }).tabId);
  return { broadcast, postMessage, tabLayouts, terminals, sentTo };
}

const threePanes = () => ({
  t1: createBranch("vertical", createLeaf("t1"), createBranch("horizontal", createLeaf("p2"), createLeaf("p3"))),
  t9: createBranch("vertical", createLeaf("t9"), createLeaf("p9")),
});

describe("BroadcastInput.set", () => {
  it("toggles the tab owning any of its panes", () => {
    const { broadcast } = setup(threePanes());
    expect(broadcast.set("p3")).toEqual({ kind: "changed", tabId: "t1", enabled: true });
    expect(broadcast.isBroadcasting("t1")).toBe(true);
    expect(broadcast.isBroadcasting("t9")).toBe(false);
    expect(broadcast.set("t1")).toEqual({ kind: "changed", tabId: "t1", enabled: false });
    expect(broadcast.isBroadcasting("t1")).toBe(false);
  });

  it("reports an explicit on/off that matches the current state as unchanged", () => {
    const { broadcast } = setup(threePanes());
    expect(broadcast.set("p2", false)).toEqual({ kind: "unchanged", tabId: "t1", enabled: false });
    broadcast.set("p2", true);
    expect(broadcast.set("p3", true)).toEqual({ kind: "unchanged", tabId: "t1", enabled: true });
  });

  it("refuses to enable a single-pane tab and records nothing", () => {
    const { broadcast, tabLayouts } = setup({ solo: createLeaf("solo") });
    expect(broadcast.set("solo")).toEqual({ kind: "single-pane", tabId: "solo" });
    // A later split must not start mirroring on its own.
    tabLayouts.set("solo", createBranch("vertical", createLeaf("solo"), createLeaf("s2")));
    expect(broadcast.isBroadcasting("solo")).toBe(false);
  });

  it("reports a pane no tab holds", () => {
    const { broadcast } = setup(threePanes());
    expect(broadcast.set("ghost")).toEqual({ kind: "unknown-pane" });
  });
});

describe("BroadcastInput.send", () => {
  it("posts only to the source pane when its tab is not broadcasting", () => {
    const { broadcast, postMessage } = setup(threePanes());
    broadcast.send("p2", "ls\r");
    expect(postMessage.mock.calls).toEqual([[{ type: "input", tabId: "p2", data: "ls\r" }]]);
  });

  it("mirrors to every pane of the tab, source first, and to no other tab", () => {
    const { broadcast, postMessage, sentTo } = setup(threePanes());
    broadcast.set("t1", true);
    broadcast.send("p2", "x");
    expect(sentTo()).toEqual(["p2", "t1", "p3"]);
    for (const [msg] of postMessage.mock.calls) {
      expect(msg).toMatchObject({ type: "input", data: "x" });
    }
  });

  it("skips exited panes", () => {
    const { broadcast, sentTo } = setup(threePanes(), ["p3"]);
    broadcast.set("t1", true);
    broadcast.send("t1", "y");
    expect(sentTo()).toEqual(["t1", "p2"]);
  });

  it("still posts to an unknown source pane, as without broadcasting", () => {
    const { broadcast, sentTo } = setup(threePanes());
    broadcast.set("t1", true);
    broadcast.send("ghost", "z");
    expect(sentTo()).toEqual(["ghost"]);
  });

  it("reaches a pane split into a broadcasting tab", () => {
    const { broadcast, tabLayouts, terminals, sentTo } = setup({
      t9: createBranch("vertical", createLeaf("t9"), createLeaf("p9")),
    });
    broadcast.set("t9", true);
    tabLayouts.set(
      "t9",
      createBranch("vertical", createLeaf("t9"), createBranch("horizontal", createLeaf("p9"), createLeaf("new"))),
    );
    terminals.set("new", { exited: false });
    broadcast.send("t9", "a");
    expect(sentTo()).toEqual(["t9", "p9", "new"]);
  });
});

describe("BroadcastInput.prune", () => {
  it("ends the broadcast when the tab collapses to one pane, for good", () => {
    const { broadcast, tabLayouts, sentTo } = setup(threePanes());
    broadcast.set("t9", true);
    tabLayouts.set("t9", createLeaf("t9"));
    expect(broadcast.isBroadcasting("t9")).toBe(false);
    expect(broadcast.prune()).toBe(true);
    tabLayouts.set("t9", createBranch("vertical", createLeaf("t9"), createLeaf("p9")));
    expect(broadcast.isBroadcasting("t9")).toBe(false);
    broadcast.send("t9", "a");
    expect(sentTo()).toEqual(["t9"]);
  });

  it("forgets a closed tab and leaves live ones alone", () => {
    const { broadcast, tabLayouts } = setup(threePanes());
    broadcast.set("t1", true);
    broadcast.set("t9", true);
    tabLayouts.delete("t9");
    expect(broadcast.prune()).toBe(true);
    expect([...broadcast.broadcastingTabIds()]).toEqual(["t1"]);
    expect(broadcast.prune()).toBe(false);
  });
});

describe("BroadcastInput.broadcastingTabIds", () => {
  it("lists only tabs that are broadcasting right now", () => {
    const { broadcast, tabLayouts } = setup(threePanes());
    broadcast.set("t1", true);
    broadcast.set("t9", true);
    tabLayouts.set("t9", createLeaf("t9"));
    expect([...broadcast.broadcastingTabIds()]).toEqual(["t1"]);
  });
});

describe("applyBroadcastCommand", () => {
  const effects = () => ({ refresh: vi.fn(), notify: vi.fn() });

  it("refreshes the tab that changed", () => {
    const { broadcast } = setup(threePanes());
    const fx = effects();
    applyBroadcastCommand(broadcast, { sessionId: "p2" }, fx);
    expect(fx.refresh).toHaveBeenCalledWith("t1");
    expect(fx.notify).not.toHaveBeenCalled();
  });

  it("tells the user why a single-pane tab did not start broadcasting", () => {
    const { broadcast } = setup({ solo: createLeaf("solo") });
    const fx = effects();
    applyBroadcastCommand(broadcast, { sessionId: "solo", enabled: true }, fx);
    expect(fx.notify).toHaveBeenCalledWith(SINGLE_PANE_NOTICE);
    expect(fx.refresh).not.toHaveBeenCalled();
  });

  it("does nothing visible for a no-op or a pane it does not know", () => {
    const { broadcast } = setup(threePanes());
    const fx = effects();
    applyBroadcastCommand(broadcast, { sessionId: "p2", enabled: false }, fx);
    applyBroadcastCommand(broadcast, { sessionId: "ghost" }, fx);
    expect(fx.refresh).not.toHaveBeenCalled();
    expect(fx.notify).not.toHaveBeenCalled();
  });

  it("stops a single-pane tab's stale request quietly", () => {
    const { broadcast } = setup({ solo: createLeaf("solo") });
    const fx = effects();
    applyBroadcastCommand(broadcast, { sessionId: "solo", enabled: false }, fx);
    expect(fx.notify).not.toHaveBeenCalled();
  });
});
