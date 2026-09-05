// @vitest-environment jsdom
// src/webview/worktree/worktreeTreeView.test.ts — the agent row's two lines, and
// which of them is title-shaped (source-the-agent-row-preview 1_4).

import { describe, expect, it } from "vitest";
import { agentRow } from "./worktreeFixtures";
import { type AgentRowOptions, renderAgentRow, renderSubagentSection } from "./worktreeTreeView";
import type { WorktreeAgentRow } from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;

function render(over: Partial<WorktreeAgentRow>): HTMLElement {
  return renderAgentRow(
    agentRow({ rowId: "row-1", title: "Building", ...over }),
    { activity: "idle", now: NOW },
    { onActivate: () => undefined },
  );
}

const previewOf = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>(".wt-apreview");

describe("the agent row's preview line", () => {
  it.each([
    ["- run the migration first", "a markdown bullet"],
    ["* run the migration first", "an asterisk bullet"],
    ["/ divided by zero", "a leading slash"],
    ["| a table row |", "a leading pipe"],
  ])("keeps %s intact (%s)", (text) => {
    const el = render({ preview: text });
    expect(previewOf(el)?.textContent).toBe(text);
    expect(previewOf(el)?.dataset.tip).toBe(text);
    expect(el.dataset.tip).toContain(text);
  });

  it("draws a line for a preview that is only a marker", () => {
    // The title stripper turns this into "" and the row then draws no second line
    // at all. In message text it is content, so the line stays.
    const el = render({ preview: "-" });
    expect(previewOf(el)?.textContent).toBe("-");
  });

  it("draws no second line when there is no preview", () => {
    expect(previewOf(render({}))).toBeNull();
    expect(previewOf(render({ preview: "" }))).toBeNull();
  });

  it("still strips the title beside it", () => {
    const el = render({ title: "⠋ Building", preview: "- a bullet" });
    expect(el.querySelector(".wt-atitle")?.textContent).toBe("Building");
    expect(previewOf(el)?.textContent).toBe("- a bullet");
  });
});

// -- Rendering one agent row with overrides (1_2) ---------------------------

function renderWith(over: Partial<WorktreeAgentRow>, opts: Partial<AgentRowOptions>): HTMLElement {
  return renderAgentRow(
    agentRow({ rowId: "row-1", title: "Building", ...over }),
    { activity: "idle", now: NOW, ...opts },
    { onActivate: () => undefined, onToggleSubagents: () => undefined },
  );
}

describe("[1_2] an agent row outside a tree", () => {
  it("is a treeitem at -1 by default, which is what the tree's roving stop needs", () => {
    const el = renderWith({ entryId: "claude:s1" }, {});
    expect(el.getAttribute("role")).toBe("treeitem");
    expect(el.tabIndex).toBe(-1);
  });

  it("offers a disclosure to a row that has a session, and none to one that has not", () => {
    // The disclosure is offered by the presence of a SESSION, not by children
    // already held — the children are read on expansion.
    const withSession = renderWith({ entryId: "claude:s1" }, {});
    expect(withSession.getAttribute("aria-expanded")).toBe("false");
    expect(withSession.querySelector(".wt-gutter")?.innerHTML).not.toBe("");

    const without = renderWith({}, {});
    expect(without.hasAttribute("aria-expanded")).toBe(false);
    expect(without.querySelector(".wt-gutter")?.innerHTML).toBe("");
  });

  it("claims no collapsed children where nothing is collapsed", () => {
    // `+2` beside two visible delegations counts them twice.
    const roster = {
      kind: "ok" as const,
      rows: [
        { name: "a", status: "completed" as const, live: false },
        { name: "b", status: "completed" as const, live: false },
      ],
    };
    expect(renderWith({ entryId: "claude:s1", delegations: roster }, {}).querySelector(".wt-count")?.textContent).toBe(
      "+2",
    );
    // Unclassed when it has nothing to say, so the selector finds nothing at all.
    expect(
      renderWith({ entryId: "claude:s1", delegations: roster }, { expanded: true }).querySelector(".wt-count"),
    ).toBeNull();
  });
});

describe("[1_2] the model the list row will not name", () => {
  it("keeps it off the visible row and puts it in the hint, its only home", () => {
    // It competed with the preview for this width and lost (§ 3.3). The drawer
    // that had room for it is gone (D49), so the hint is where it lives now.
    const el = renderWith({ model: "claude-opus-5", title: "t" }, {});
    expect(el.querySelector(".wt-amodel")).toBeNull();
    expect(el.textContent).not.toContain("claude-opus-5");
    expect(el.dataset.tip?.split("\n")).toContain("claude-opus-5");
  });

  it("names nothing at all when the model is unknown", () => {
    // A placeholder would claim we asked and were told (§ 3.3).
    expect(renderWith({ title: "t" }, {}).dataset.tip).not.toContain("claude-opus-5");
    // Line COUNT, not membership: an empty model must add no line at all. The
    // old `not.toContain("")` passed with or without the rule (round-2 F017).
    expect(renderWith({ model: "", title: "t" }, {}).dataset.tip?.split("\n")).toEqual(["t"]);
  });

  it("adds no root child, so the row keeps its seven grid tracks", () => {
    // `.wt-arow` declares exactly seven tracks and pins every non-preview root
    // child to row 1; an eighth would add an implicit column.
    const bare = renderWith({ preview: "p" }, {});
    const withModel = renderWith({ model: "claude-opus-5", preview: "p" }, {});
    expect(withModel.children.length).toBe(bare.children.length);
  });
});

describe("[1_2] a delegation section outside a tree", () => {
  const parent = agentRow({ rowId: "row-1", entryId: "claude:s1" });

  it("keeps the tree's roles by default", () => {
    const el = renderSubagentSection(undefined, parent, () => undefined, NOW);
    expect(el.getAttribute("role")).toBe("group");
  });

  it("keeps every row on the tree's roles and off the tab order", () => {
    // The tree moves ONE roving stop between rows; a row raised to 0 here would
    // be a second stop the traversal does not know about.
    const roster = { kind: "ok" as const, rows: [{ name: "a", status: "completed" as const, live: false }] };
    const el = renderSubagentSection(roster, parent, () => undefined, NOW);
    const row = el.querySelector<HTMLElement>(".wt-srow");
    expect(row?.getAttribute("role")).toBe("treeitem");
    expect(row?.tabIndex).toBe(-1);
  });

  it("reads an unheld roster as pending, because only an asked-for row is drawn", () => {
    // The section renders only under an EXPANDED row, and only a row with a
    // session can expand — so a roster has always been asked for by now.
    const waiting = renderSubagentSection(undefined, parent, () => undefined, NOW);
    expect(waiting.textContent).toContain("Reading…");
  });
});

describe("a preview that adds nothing to the row", () => {
  it("draws no second line when it repeats the title", () => {
    const el = render({ title: "Building", preview: "Building" });
    expect(previewOf(el)).toBeNull();
  });

  it("names the sentence once in the row's hover text", () => {
    const el = render({ title: "Building", preview: "Building" });
    expect(el.dataset.tip?.split("\n").filter((line) => line === "Building")).toHaveLength(1);
  });

  it("still draws a preview that differs from the title by one word", () => {
    const el = render({ title: "Building", preview: "Building the extension" });
    expect(previewOf(el)?.textContent).toBe("Building the extension");
  });

  it("still draws a preview whose marker the title's stripper would eat", () => {
    const el = render({ title: "Building", preview: "* Building" });
    expect(previewOf(el)?.textContent).toBe("* Building");
  });

  it("draws the line again once the session says something else", () => {
    expect(previewOf(render({ title: "Building", preview: "Building" }))).toBeNull();
    expect(previewOf(render({ title: "Building", preview: "Bash: pnpm test" }))?.textContent).toBe("Bash: pnpm test");
  });
});
