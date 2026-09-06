// @vitest-environment jsdom

// src/webview/worktree/worktreeTreeView.hostChip.test.ts — what the scope chip
// says about a row this window does not run.
//
// The old wording asserted "another VS Code window" of every external row, which
// is false whenever another APPLICATION is running the session — and that false
// sentence is what sent a user hunting for a bug in this extension.

import { describe, expect, it } from "vitest";
import type { WorktreeAgentRow } from "../../worktree/presenceTypes";
import { renderAgentRow } from "./worktreeTreeView";

function external(over: Partial<WorktreeAgentRow> = {}): WorktreeAgentRow {
  return {
    rowId: "external:claude:s1",
    scope: "external",
    agent: "claude",
    agentSource: "registry",
    activity: "running",
    activitySource: "registry",
    entryId: "claude:s1",
    title: "cyberk-skills-3b",
    ...over,
  };
}

function chip(row: WorktreeAgentRow): { text: string; tip: string | undefined } {
  const el = renderAgentRow(row, { activity: row.activity, now: Date.now() }, { onActivate: () => {} });
  const scope = el.querySelector(".wt-scope");
  return { text: scope?.textContent ?? "", tip: (scope as HTMLElement | null)?.dataset.tip };
}

describe("the scope chip", () => {
  it("names the application running the session when one was identified", () => {
    expect(chip(external({ host: "Orca" }))).toEqual({ text: "Orca", tip: "Running in Orca" });
  });

  it("falls back to the neutral phrase when no application could be named", () => {
    // Never "another VS Code window": we do not know that, and on this user's
    // machine it was not true.
    const { text, tip } = chip(external());
    expect(text).toBe("other window");
    expect(tip).toBe("Running outside this window");
    expect(tip).not.toContain("VS Code");
  });

  it("treats a blank host as no host rather than drawing an empty chip", () => {
    expect(chip(external({ host: "   " })).text).toBe("other window");
  });

  it("draws no chip at all on a row this window runs", () => {
    const row = external({ rowId: "window:p1", scope: "window", paneId: "p1" });
    expect(chip(row).text).toBe("");
  });
});
