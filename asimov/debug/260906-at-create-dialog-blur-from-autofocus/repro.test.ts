// @vitest-environment jsdom
//
// "click vào 'Run setup' checkbox là báo lỗi?" — with the field still empty.
//
// The form calls `shell.focusInitial(nameInput)` when it opens, so the caret is
// in Branch name before the user has done anything. Clicking any control in the
// dialog therefore BLURS that field, and blur is what asks the host and what the
// form treats as the user having answered. The host answers honestly — "" is not
// a branch name — and the refusal is painted against a field nobody typed in.

import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeCreateResolutionMessage } from "../../../src/types/messages";
import { openWorktreeCreateDialog } from "../../../src/webview/worktree/WorktreeCreateDialog";
import { createDefaults, REPO_ID } from "../../../src/webview/worktree/worktreeFixtures";

afterEach(() => {
  document.body.replaceChildren();
});

/** The host as it really answers: "" is not a name git will take. */
function open() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let apply: ((r: WorktreeCreateResolutionMessage) => void) | undefined;
  let seq = 0;
  openWorktreeCreateDialog(host, {
    repos: [createDefaults()],
    onSubmit: () => undefined,
    // The verdict rides the RESOLUTION channel, not the defaults one — asking on
    // the wrong channel is how this was mis-eliminated the first time round.
    bindResolution: (fn) => {
      apply = fn;
    },
    onSelectionChange: (s) => {
      seq += 1;
      apply?.({
        type: "worktreeCreateResolution",
        repoId: REPO_ID,
        token: 1,
        seq,
        query: s.branch,
        mode: { kind: "fresh" },
        freePath: "/trees/repo-x",
        // git's real shape: a space is not allowed in a ref name.
        branchValid: s.branch.includes(" ")
          ? { ok: false, reason: `git will not take "${s.branch}" as a branch name.` }
          : s.branch.trim()
            ? { ok: true }
            : { ok: false, reason: `git will not take "" as a branch name.` },
      });
    },
  });
  return host;
}

const field = (host: HTMLElement): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>("#wt-branch");
  if (!el) {
    throw new Error("the form has no branch input");
  }
  return el;
};

/** The red message under the field, or "" when there is none. */
function refusal(host: HTMLElement): string {
  const el = host.querySelector<HTMLElement>(".wt-ferror");
  return el && !el.hidden ? (el.textContent ?? "") : "";
}

describe("clicking a control does not refuse a name nobody typed", () => {
  it("says nothing, and marks nothing, when the click blurs the field the form focused", () => {
    const host = open();
    const input = field(host);
    // What the browser does when the user clicks a checkbox in the dialog: the
    // caret the form placed here leaves. No typing has happened.
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    const said = refusal(host);
    const marked = input.classList.contains("is-invalid") || input.getAttribute("aria-invalid") === "true";
    console.log(`refusal after the click: ${JSON.stringify(said)}`);
    console.log(`OBSERVES 1: ${said ? "RED" : "GREEN"}`);
    console.log(`OBSERVES 2: ${marked ? "RED" : "GREEN"}`);
    expect(said, "the form refused a name nobody typed").toBe("");
    expect(marked, "the field was marked invalid before anyone typed in it").toBe(false);
  });

  // Guards, not observations: these are GREEN today and must stay GREEN.
  it("still refuses a name the user typed and git will not take", () => {
    const host = open();
    const input = field(host);
    // Left AS TYPED. Clearing it back to empty is not "a name git will not take"
    // — it is no name at all, and git is not asked about one
    // (260906-at-create-dialog-resolves-an-empty-name). The title of this guard
    // was always about a name the user typed; the body had been emptying it.
    input.value = "brand new";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(refusal(host)).not.toBe("");
  });
});
