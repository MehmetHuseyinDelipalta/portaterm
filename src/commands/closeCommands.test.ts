// The doors, not the gate — `closeGates.test.ts` owns the gate. Every case here
// is a counterexample the cycle actually produced: a door that never asked, a
// door that weighed one pane and destroyed another, and a door that posted to
// the focused sidebar for a pane an editor owned.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOSE_COMMAND_IDS, type CloseCommandDeps, createCloseCommands } from "./closeCommands";

const AGENT = { exited: false, isAgentLaunch: true, shell: "claude" };
const SHELL = { exited: false, isAgentLaunch: false, shell: "zsh" };

interface World {
  panes?: Record<string, typeof AGENT | typeof SHELL>;
  /** Which session each surface reports as active. */
  focused?: string;
  surface?: Partial<Record<"sidebar" | "panel", string>>;
  ctxActive?: string;
  splits?: readonly string[];
  tabs?: Record<string, string[]>;
  /** Which surface holds each session — the destination assertion. */
  surfaceOf?: Record<string, string>;
  answer?: string;
}

function world(w: World = {}) {
  const asked: string[] = [];
  const destroyed: string[] = [];
  const posted: { surface: string; message: { type: string; tabId?: string; sessionId?: string } }[] = [];
  const deps: CloseCommandDeps = {
    evidence: { read: (id) => w.panes?.[id] },
    ui: {
      showWarningMessage: (message, options) => {
        asked.push(`${message} ${options.detail ?? ""}`);
        return Promise.resolve(w.answer);
      },
    },
    panesOfTab: (tabId) => w.tabs?.[tabId] ?? [tabId],
    isSplitPane: (sessionId) => (w.splits ?? []).includes(sessionId),
    destroySession: (id) => destroyed.push(id),
    postToSession: (sessionId, message) => {
      posted.push({
        surface: w.surfaceOf?.[sessionId] ?? "sidebar",
        message: message as { type: string; tabId?: string; sessionId?: string },
      });
    },
    focusedActiveSession: () => w.focused,
    surfaceActiveSession: (location) => w.surface?.[location],
    ctxActiveSession: () => w.ctxActive,
  };
  return { commands: createCloseCommands(deps), asked, destroyed, posted };
}

/** Let the gate's promise chain settle — every door is fire-and-forget. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("the destructive command inventory", () => {
  it("is every destructive command the extension actually contributes", () => {
    // Compared against `package.json`, not another literal: a list that only
    // agrees with itself cannot catch a door registered outside this factory,
    // which is the whole reason the factory exists (round-1 F002).
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      contributes: { commands: { command: string }[] };
    };
    const destructive = manifest.contributes.commands
      .map((c) => c.command)
      .filter((id) => /\.(kill|close)/i.test(id))
      .sort();
    expect(destructive).toEqual([...CLOSE_COMMAND_IDS].sort());
  });

  it("builds a handler for every id it claims", () => {
    const { commands } = world();
    for (const id of CLOSE_COMMAND_IDS) {
      expect(typeof commands.byId[id]).toBe("function");
    }
  });
});

describe("every door asks before destroying a live agent", () => {
  it("ctx.killTerminal does — it used to destroy outright (F001)", async () => {
    const w = world({ panes: { p1: AGENT }, answer: undefined });
    w.commands.byId["portaterm.ctx.killTerminal"]({ paneSessionId: "p1" });
    await settle();
    expect(w.asked).toHaveLength(1);
    expect(w.destroyed).toEqual([]);
    expect(w.posted).toEqual([]);
  });

  it("and destroys once approved", async () => {
    const w = world({ panes: { p1: AGENT }, answer: "Kill Terminal" });
    w.commands.byId["portaterm.ctx.killTerminal"]({ paneSessionId: "p1" });
    await settle();
    expect(w.destroyed).toEqual(["p1"]);
    expect(w.posted[0]?.message).toEqual({ type: "tabRemoved", tabId: "p1" });
  });

  it("killTerminal does, for the focused surface's session", async () => {
    const w = world({ panes: { f1: AGENT }, focused: "f1", answer: undefined });
    w.commands.byId["portaterm.killTerminal"]();
    await settle();
    expect(w.asked).toHaveLength(1);
    expect(w.destroyed).toEqual([]);
  });

  it("closeSplitPane does", async () => {
    const w = world({ panes: { f1: AGENT }, focused: "f1", answer: undefined });
    w.commands.byId["portaterm.closeSplitPane"]();
    await settle();
    expect(w.asked).toHaveLength(1);
    expect(w.posted).toEqual([]);
  });

  it("ctx.closePane does", async () => {
    const w = world({ panes: { p1: AGENT }, answer: undefined });
    w.commands.byId["portaterm.ctx.closePane"]({ paneSessionId: "p1" });
    await settle();
    expect(w.asked).toHaveLength(1);
    expect(w.posted).toEqual([]);
  });
});

describe("the pane a door names is the pane it acts on", () => {
  it("ctx.killTerminal ignores what the focused surface calls active (F002 shape)", async () => {
    // The right-clicked pane runs an agent; the focused surface's own pane is an
    // idle shell. Resolving the wrong one would skip the question entirely.
    const w = world({
      panes: { idle: SHELL, agent: AGENT },
      ctxActive: "idle",
      answer: "Kill Terminal",
    });
    w.commands.byId["portaterm.ctx.killTerminal"]({ paneSessionId: "agent" });
    await settle();
    expect(w.asked[0]).toContain("claude is still running here");
    expect(w.destroyed).toEqual(["agent"]);
  });

  it("ctx.closePane acts on nothing when no pane was named", async () => {
    // There is no honest fallback: the focused surface's pane is a different
    // pane than the one right-clicked.
    const w = world({ panes: { idle: SHELL }, ctxActive: "idle", focused: "idle" });
    w.commands.byId["portaterm.ctx.closePane"]({});
    await settle();
    expect(w.posted).toEqual([]);
    expect(w.destroyed).toEqual([]);
  });

  it("ctx.killTerminal falls back to the ctx surface, not the focused one", async () => {
    const w = world({ panes: { c1: SHELL }, ctxActive: "c1", focused: "other" });
    w.commands.byId["portaterm.ctx.killTerminal"]({});
    await settle();
    expect(w.destroyed).toEqual(["c1"]);
  });
});

describe("the surface that hears about it is the one holding the session", () => {
  it("posts to the editor for an editor-owned pane, never the focused sidebar (F006)", async () => {
    const w = world({
      panes: { e1: SHELL },
      surfaceOf: { e1: "editor-42" },
      answer: "Close Pane",
    });
    w.commands.byId["portaterm.ctx.closePane"]({ paneSessionId: "e1" });
    await settle();
    expect(w.posted).toEqual([{ surface: "editor-42", message: { type: "closeSplitPaneById", sessionId: "e1" } }]);
  });
});

describe("a kill picks the protocol the target actually needs", () => {
  it("uses the pane protocol for a focused split, not the tab one (F008)", async () => {
    const w = world({ panes: { s1: SHELL }, focused: "s1", splits: ["s1"] });
    w.commands.byId["portaterm.killTerminal"]();
    await settle();
    expect(w.posted[0]?.message).toEqual({ type: "closeSplitPaneById", sessionId: "s1" });
    expect(w.destroyed).toEqual([]);
  });

  it("uses the tab protocol for a root, and weighs the whole tab", async () => {
    // Non-vacuous counterpart: same id, not a split, and the agent in its split
    // sibling is what the question is about.
    const w = world({
      panes: { t1: SHELL, p2: AGENT },
      focused: "t1",
      tabs: { t1: ["t1", "p2"] },
      answer: "Kill Terminal",
    });
    w.commands.byId["portaterm.killTerminal"]();
    await settle();
    expect(w.asked[0]).toContain("claude is still running here");
    expect(w.destroyed).toEqual(["t1"]);
    expect(w.posted[0]?.message).toEqual({ type: "tabRemoved", tabId: "t1" });
  });
});

describe("the per-location doors", () => {
  it("gate a surface-bound kill the same way, on that surface's own session", async () => {
    // `killTerminal.{sidebar,panel}` resolve their own surface rather than the
    // focused one; only resolution differs, which is why it is a seam.
    const w = world({ panes: { s1: AGENT }, focused: "elsewhere", surface: { sidebar: "s1" }, answer: undefined });
    w.commands.byId["portaterm.killTerminal.sidebar"]();
    await settle();
    expect(w.asked).toHaveLength(1);
    expect(w.destroyed).toEqual([]);
  });

  it("do nothing when their surface has no session", async () => {
    const w = world({ surface: {} });
    w.commands.byId["portaterm.killTerminal.panel"]();
    await settle();
    expect(w.destroyed).toEqual([]);
    expect(w.asked).toEqual([]);
  });
});
