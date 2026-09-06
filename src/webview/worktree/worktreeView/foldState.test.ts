// src/webview/worktree/worktreeView/foldState.test.ts — The fold rules, driven
// without a view. No environment pragma: this module touches no DOM, and running
// it under node is what proves that.

import { describe, expect, it, vi } from "vitest";
import { createFoldState, type FoldPruneInput, type FoldStateDeps, idleTailKey } from "./foldState";

function harness(over: Partial<FoldStateDeps> = {}) {
  const persistCollapsed = vi.fn();
  const persistExpandedRows = vi.fn();
  const persistIdleSeeded = vi.fn();
  const repaint = vi.fn();
  let query = "";
  const fold = createFoldState({
    persisted: undefined,
    initialExpandedRows: [],
    initialIdleSeeded: [],
    idleFoldThreshold: 4,
    persistCollapsed,
    persistExpandedRows,
    persistIdleSeeded,
    query: () => query,
    repaint,
    ...over,
  });
  return {
    fold,
    persistCollapsed,
    persistExpandedRows,
    persistIdleSeeded,
    repaint,
    setQuery: (q: string) => {
      query = q;
    },
  };
}

function prune(over: Partial<FoldPruneInput> = {}): FoldPruneInput {
  return {
    repos: [],
    liveIds: new Set(),
    liveRowIds: new Set(),
    sessionRowIds: new Set(),
    ...over,
  };
}

const repo = (id: string, worktrees: { id: string; inWorkspace: boolean }[], idleCount = 0) => ({
  repoId: id,
  idleCount,
  worktrees,
});

describe("folding", () => {
  it("persists and repaints on every flip, whichever row kind asked", () => {
    const h = harness();
    h.fold.toggleKey("r1");
    expect(h.fold.isCollapsed("r1")).toBe(true);
    expect(h.persistCollapsed).toHaveBeenCalledWith(["r1"]);
    expect(h.repaint).toHaveBeenCalledTimes(1);

    h.fold.toggleCollapsed("r1");
    expect(h.fold.isCollapsed("r1")).toBe(false);
    expect(h.persistCollapsed).toHaveBeenLastCalledWith([]);
  });

  it("reads a worktree's openness off the collapsed set and nothing else", () => {
    const h = harness({ persisted: ["w1"] });
    expect(h.fold.isExpanded("w1")).toBe(false);
    expect(h.fold.isExpanded("w2")).toBe(true);
  });

  it("keeps a live filter from spending a fold the user never chose", () => {
    const h = harness();
    h.fold.toggleIdleTail("r1");
    expect(h.fold.isCollapsed(idleTailKey("r1"))).toBe(true);

    h.setQuery("api");
    // Revealed, not unfolded: the stored decision is untouched…
    expect(h.fold.idleTailFolded("r1")).toBe(false);
    h.fold.toggleIdleTail("r1");
    expect(h.fold.isCollapsed(idleTailKey("r1"))).toBe(true);

    h.setQuery("");
    expect(h.fold.idleTailFolded("r1")).toBe(true);
  });
});

describe("pruning against the tree that just arrived", () => {
  it("collapses a worktree seen for the first time unless it is a workspace folder", () => {
    const h = harness();
    h.fold.prune(
      prune({
        repos: [
          repo("r1", [
            { id: "w1", inWorkspace: false },
            { id: "w2", inWorkspace: true },
          ]),
        ],
        liveIds: new Set(["r1", "w1", "w2"]),
      }),
    );
    expect(h.fold.isExpanded("w1")).toBe(false);
    expect(h.fold.isExpanded("w2")).toBe(true);
  });

  it("does not reseed anything in the first tree when a set was restored", () => {
    // Presence of the array is the signal; its emptiness says nothing.
    const h = harness({ persisted: [] });
    h.fold.prune(
      prune({
        repos: [repo("r1", [{ id: "w1", inWorkspace: false }])],
        liveIds: new Set(["r1", "w1"]),
      }),
    );
    expect(h.fold.isExpanded("w1")).toBe(true);
  });

  it("folds a repo's idle tail the first time it has one, and remembers it was presented", () => {
    const h = harness();
    const trees = prune({
      repos: [repo("r1", [{ id: "w1", inWorkspace: true }], 4)],
      liveIds: new Set(["r1", "w1"]),
    });
    h.fold.prune(trees);
    expect(h.fold.idleTailFolded("r1")).toBe(true);
    expect(h.persistIdleSeeded).toHaveBeenCalledWith(["r1"]);

    // Unfolded by the user, then a second tree arrives: seeding does not repeat.
    h.fold.toggleIdleTail("r1");
    h.fold.prune(trees);
    expect(h.fold.idleTailFolded("r1")).toBe(false);
  });

  it("drops a row's expansion once presence stops carrying its session", () => {
    const h = harness({ initialExpandedRows: ["row1", "row2"] });
    h.fold.prune(
      prune({
        liveIds: new Set(["r1"]),
        liveRowIds: new Set(["row1", "row2"]),
        sessionRowIds: new Set(["row1"]),
      }),
    );
    expect(h.fold.isRowExpanded("row1")).toBe(true);
    expect(h.fold.isRowExpanded("row2")).toBe(false);
    expect(h.persistExpandedRows).toHaveBeenCalledWith(["row1"]);
  });

  it("writes no persistence when the reconciliation changed nothing", () => {
    const h = harness({ persisted: ["w1"] });
    h.fold.prune(
      prune({
        repos: [repo("r1", [{ id: "w1", inWorkspace: false }])],
        liveIds: new Set(["r1", "w1"]),
      }),
    );
    expect(h.persistCollapsed).not.toHaveBeenCalled();
    expect(h.persistIdleSeeded).not.toHaveBeenCalled();
    expect(h.persistExpandedRows).not.toHaveBeenCalled();
  });

  it("forgets a worktree that left, so a reused id is seeded afresh", () => {
    const h = harness();
    h.fold.prune(
      prune({
        repos: [repo("r1", [{ id: "w1", inWorkspace: true }])],
        liveIds: new Set(["r1", "w1"]),
      }),
    );
    expect(h.fold.isExpanded("w1")).toBe(true);

    // w1 leaves entirely…
    h.fold.prune(prune({ repos: [repo("r1", [])], liveIds: new Set(["r1"]) }));
    // …and comes back on a path the user never opened: it is new again, so it folds.
    h.fold.prune(
      prune({
        repos: [repo("r1", [{ id: "w1", inWorkspace: false }])],
        liveIds: new Set(["r1", "w1"]),
      }),
    );
    expect(h.fold.isExpanded("w1")).toBe(false);
  });
});
