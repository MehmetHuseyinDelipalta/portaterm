// @vitest-environment jsdom
//
// The red is gone; the plan under it is not. Clicking a control still blurs the
// field the form focused, and that blur still ASKS the host what a create would
// do. The host answers for the empty name — a free suffixed path, a collision
// note, a debris offer to clear a folder — and the form renders the whole plan
// for a worktree nobody has named.

import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeCreateResolutionMessage } from "../../../src/types/messages";
import { openWorktreeCreateDialog } from "../../../src/webview/worktree/WorktreeCreateDialog";
import { createDefaults, REPO_ID } from "../../../src/webview/worktree/worktreeFixtures";

afterEach(() => {
  document.body.replaceChildren();
});

function open() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let apply: ((r: WorktreeCreateResolutionMessage) => void) | undefined;
  const asked: string[] = [];
  let seq = 0;
  openWorktreeCreateDialog(host, {
    repos: [createDefaults()],
    onSubmit: () => undefined,
    bindResolution: (fn) => {
      apply = fn;
    },
    // The host as it really answers: it resolves whatever it is asked about,
    // including the empty name, and reports the collision it found.
    onSelectionChange: (selection) => {
      asked.push(selection.branch);
      seq += 1;
      apply?.({
        type: "worktreeCreateResolution",
        repoId: REPO_ID,
        token: 1,
        seq,
        query: selection.branch,
        mode: { kind: "fresh" },
        freePath: "/repo/.claude/worktrees/cyberk-skills-2",
        collidesWith: "/repo/.claude/worktrees/cyberk-skills",
        branchValid: selection.branch.trim() ? { ok: true } : { ok: false, reason: 'git will not take "" as a branch name.' },
      } as WorktreeCreateResolutionMessage);
    },
  });
  return { host, asked };
}

const field = (host: HTMLElement): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>("#wt-branch");
  if (!el) {
    throw new Error("the form has no branch input");
  }
  return el;
};

describe("the form does not plan a create for a name nobody has typed", () => {
  it("neither asks about the empty name nor draws a plan for it", () => {
    const { host, asked } = open();
    const before = (host.textContent ?? "").replace(/\s+/g, " ");
    field(host).dispatchEvent(new Event("blur", { bubbles: true }));
    const after = (host.textContent ?? "").replace(/\s+/g, " ");

    console.log(`asked about: ${JSON.stringify(asked)}`);
    console.log(`OBSERVES 1: ${asked.length > 0 ? "RED" : "GREEN"}`);
    console.log(`OBSERVES 2: ${before === after ? "GREEN" : "RED"}`);
    expect(asked, "the host was asked what a create for the empty name would do").toEqual([]);
    expect(after, "the form redrew its destination plan for a name nobody typed").toBe(before);
  });

  // Guard: the moment there IS a name, the form asks and plans as it always did.
  it("asks as soon as the user names something", () => {
    const { host, asked } = open();
    const input = field(host);
    input.value = "feat/x";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(asked).toContain("feat/x");
    expect((host.textContent ?? "").replace(/\s+/g, " ")).toContain("cyberk-skills-2");
  });
});
