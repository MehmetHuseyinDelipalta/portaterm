// src/webview/splitIntegrationEdgeCases.test.ts — Edge-case tests for recursive split tree restructuring
//
// Tests cover: deep (3+ level) removeLeaf operations, sequential close-all,
// and getAllSessionIds consistency after each removal.

import { describe, expect, it } from "vitest";
import { createBranch, createLeaf, getAllSessionIds, removeLeaf, type SplitNode } from "./SplitModel";

// ─── Helper ─────────────────────────────────────────────────────────

/**
 * Build a 3-level deep tree:
 *
 *            root (H)
 *           /        \
 *        brL (V)      brR (V)
 *       /    \       /    \
 *      A      B     C      D
 *
 * H = horizontal, V = vertical
 */
function buildThreeLevelTree() {
  const a = createLeaf("A");
  const b = createLeaf("B");
  const c = createLeaf("C");
  const d = createLeaf("D");
  const branchLeft = createBranch("vertical", a, b);
  const branchRight = createBranch("vertical", c, d);
  const root = createBranch("horizontal", branchLeft, branchRight);
  return { root, a, b, c, d, branchLeft, branchRight };
}

/** Assert a value is not null and return it with narrowed type. */
function assertNonNull<T>(value: T | null, message = "expected non-null"): T {
  expect(value, message).not.toBeNull();
  return value as T;
}

// ─── 3-level deep removeLeaf from left subtree ─────────────────────

describe("removeLeaf — 3-level deep left subtree", () => {
  it("removes leaf A and collapses left branch to B", () => {
    const { root } = buildThreeLevelTree();
    const result = assertNonNull(removeLeaf(root, "A"));

    // Left subtree should collapse to leaf B; right subtree unchanged
    expect(result.type).toBe("branch");
    if (result.type === "branch") {
      // Left child should now be leaf B (collapsed from the branch)
      expect(result.children[0]).toEqual({ type: "leaf", sessionId: "B" });
      // Right child should still be the original right branch
      expect(result.children[1].type).toBe("branch");
    }
    expect(getAllSessionIds(result).sort()).toEqual(["B", "C", "D"]);
  });

  it("removes leaf B and collapses left branch to A", () => {
    const { root } = buildThreeLevelTree();
    const result = assertNonNull(removeLeaf(root, "B"));

    expect(result.type).toBe("branch");
    if (result.type === "branch") {
      expect(result.children[0]).toEqual({ type: "leaf", sessionId: "A" });
      expect(result.children[1].type).toBe("branch");
    }
    expect(getAllSessionIds(result).sort()).toEqual(["A", "C", "D"]);
  });
});

// ─── 3-level deep removeLeaf from right subtree ────────────────────

describe("removeLeaf — 3-level deep right subtree", () => {
  it("removes leaf C and collapses right branch to D", () => {
    const { root } = buildThreeLevelTree();
    const result = assertNonNull(removeLeaf(root, "C"));

    expect(result.type).toBe("branch");
    if (result.type === "branch") {
      // Left subtree unchanged
      expect(result.children[0].type).toBe("branch");
      // Right child should now be leaf D (collapsed)
      expect(result.children[1]).toEqual({ type: "leaf", sessionId: "D" });
    }
    expect(getAllSessionIds(result).sort()).toEqual(["A", "B", "D"]);
  });

  it("removes leaf D and collapses right branch to C", () => {
    const { root } = buildThreeLevelTree();
    const result = assertNonNull(removeLeaf(root, "D"));

    expect(result.type).toBe("branch");
    if (result.type === "branch") {
      expect(result.children[0].type).toBe("branch");
      expect(result.children[1]).toEqual({ type: "leaf", sessionId: "C" });
    }
    expect(getAllSessionIds(result).sort()).toEqual(["A", "B", "C"]);
  });
});

// ─── Close all inner panes one by one ───────────────────────────────

describe("sequential close-all until single leaf remains", () => {
  it("closes 4 panes one by one, verifying tree at each step", () => {
    const { root } = buildThreeLevelTree();

    // Initial state: 4 leaves
    expect(getAllSessionIds(root).sort()).toEqual(["A", "B", "C", "D"]);

    // Remove A — 3 leaves remain
    const afterA = assertNonNull(removeLeaf(root, "A"));
    expect(getAllSessionIds(afterA).sort()).toEqual(["B", "C", "D"]);
    // Left subtree collapsed: root should now have leaf B on the left
    expect(afterA.type).toBe("branch");
    if (afterA.type === "branch") {
      expect(afterA.children[0]).toEqual({ type: "leaf", sessionId: "B" });
    }

    // Remove C — 2 leaves remain
    const afterC = assertNonNull(removeLeaf(afterA, "C"));
    expect(getAllSessionIds(afterC).sort()).toEqual(["B", "D"]);
    // Both subtrees are now leaves
    expect(afterC.type).toBe("branch");
    if (afterC.type === "branch") {
      expect(afterC.children[0]).toEqual({ type: "leaf", sessionId: "B" });
      expect(afterC.children[1]).toEqual({ type: "leaf", sessionId: "D" });
    }

    // Remove D — single leaf remains
    const afterD = assertNonNull(removeLeaf(afterC, "D"));
    expect(afterD.type).toBe("leaf");
    expect(getAllSessionIds(afterD)).toEqual(["B"]);

    // Remove B — tree becomes empty (null)
    const afterB = removeLeaf(afterD, "B");
    expect(afterB).toBeNull();
  });
});

// ─── getAllSessionIds consistency after each removal ─────────────────

describe("getAllSessionIds consistency after removals", () => {
  it("returns correct IDs after each sequential removal", () => {
    const { root } = buildThreeLevelTree();
    const removalOrder = ["B", "D", "A", "C"];
    let tree: SplitNode = root;
    const expected = new Set(["A", "B", "C", "D"]);

    for (const id of removalOrder) {
      expected.delete(id);
      const next = removeLeaf(tree, id);

      if (expected.size === 0) {
        expect(next).toBeNull();
      } else {
        const narrowed = assertNonNull(next);
        expect(getAllSessionIds(narrowed).sort()).toEqual([...expected].sort());
        tree = narrowed;
      }
    }
  });

  it("handles removal from a 4-level deep tree", () => {
    //        root (H)
    //       /        \
    //    deep (V)     D
    //   /      \
    //  inner (H)  C
    //  /    \
    // A      B
    const inner = createBranch("horizontal", createLeaf("A"), createLeaf("B"));
    const deep = createBranch("vertical", inner, createLeaf("C"));
    const root = createBranch("horizontal", deep, createLeaf("D"));

    expect(getAllSessionIds(root).sort()).toEqual(["A", "B", "C", "D"]);

    // Remove deepest-left leaf A
    const afterA = assertNonNull(removeLeaf(root, "A"));
    expect(getAllSessionIds(afterA).sort()).toEqual(["B", "C", "D"]);

    // The inner branch should have collapsed: deep's first child is now leaf B
    if (afterA.type === "branch") {
      const leftSubtree = afterA.children[0];
      expect(leftSubtree.type).toBe("branch");
      if (leftSubtree.type === "branch") {
        expect(leftSubtree.children[0]).toEqual({ type: "leaf", sessionId: "B" });
        expect(leftSubtree.children[1]).toEqual({ type: "leaf", sessionId: "C" });
      }
    }

    // Remove B — deep collapses to leaf C
    const afterB = assertNonNull(removeLeaf(afterA, "B"));
    expect(getAllSessionIds(afterB).sort()).toEqual(["C", "D"]);
    if (afterB.type === "branch") {
      expect(afterB.children[0]).toEqual({ type: "leaf", sessionId: "C" });
      expect(afterB.children[1]).toEqual({ type: "leaf", sessionId: "D" });
    }

    // Remove C — single leaf D
    const afterC = assertNonNull(removeLeaf(afterB, "C"));
    expect(afterC).toEqual({ type: "leaf", sessionId: "D" });

    // Remove D — null
    const afterD = removeLeaf(afterC, "D");
    expect(afterD).toBeNull();
  });
});
