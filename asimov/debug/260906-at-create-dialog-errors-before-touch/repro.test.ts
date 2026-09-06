// @vitest-environment jsdom
//
// "mở create worktree dialog; tên vẫn empty; click vào bất kì checkbox/button nào
//  thì lập tức báo lỗi => chỉ nên báo lỗi khi out focus thôi"
//
// The click is not what produces it: the form states the refusal from the moment
// it opens, against a field the user has not had a chance to type in. The click
// is simply when the user looks down and reads it. So the repro asserts the
// contract the report is asking for — nothing refuses an untouched name — and
// covers the reported gesture as well as the open.

import { afterEach, describe, expect, it } from "vitest";
import { openWorktreeCreateDialog } from "../../../src/webview/worktree/WorktreeCreateDialog";
import { createDefaults } from "../../../src/webview/worktree/worktreeFixtures";

// The dialog mounts an overlay; without this, a second open in the same file
// finds the first one's DOM still standing (the project's own suite does the same).
afterEach(() => {
  document.body.replaceChildren();
});

function open() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let apply: ((n: unknown) => void) | undefined;
  openWorktreeCreateDialog(host, {
    repos: [createDefaults()],
    onSubmit: () => undefined,
    bindDefaults: (fn) => {
      apply = fn as (n: unknown) => void;
    },
    // Wired, as production is: every asked selection gets an answer back.
    onSelectionChange: (s) => {
      apply?.(
        createDefaults({
          answersBranch: s.branch,
          branchValid: s.branch.trim() ? { ok: true } : { ok: false, reason: 'git will not take "" as a branch name.' },
        }),
      );
    },
  });
  return host;
}

/** Everything on screen that refuses the name, red or grey. */
function refusal(host: HTMLElement): string {
  const field = host.querySelector<HTMLElement>(".wt-ferror");
  const reason = host.querySelector<HTMLElement>(".wt-create-disabled-reason");
  const parts = [field, reason]
    .filter((el): el is HTMLElement => el !== null && !el.hidden)
    .map((el) => el.textContent ?? "")
    .filter((t) => /branch name|will not take/i.test(t));
  return parts.join(" | ");
}

const branchInput = (host: HTMLElement): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>("#wt-branch");
  if (!el) {
    throw new Error("the form has no branch input");
  }
  return el;
};

describe("the create form does not refuse a name the user has not typed", () => {
  it("OBSERVES 1: says nothing about the name on open", () => {
    const host = open();
    const said = refusal(host);
    console.log(`refusal on open: ${JSON.stringify(said)}`);
    console.log(`OBSERVES 1: ${said ? "RED" : "GREEN"}`);
    expect(said, "the form refused the name before the user could type one").toBe("");
  });

  it("OBSERVES 2: still says nothing after every checkbox in the form is clicked", () => {
    const host = open();
    for (const el of host.querySelectorAll<HTMLElement>("input[type=checkbox]")) {
      el.click();
    }
    const said = refusal(host);
    console.log(`refusal after clicking every checkbox: ${JSON.stringify(said)}`);
    console.log(`OBSERVES 2: ${said ? "RED" : "GREEN"}`);
    expect(said, "clicking a control refused a name the user never typed").toBe("");
  });

  // A guard, not an observation: this one is GREEN today and must stay GREEN,
  // so it can never be RED and cannot be declared as something to reproduce.
  it("still says it once the user has used the field and left it empty", () => {
    const host = open();
    const input = branchInput(host);
    // Typed in, then emptied. A bare focus/blur is NOT this: the form focuses
    // this field itself, so the caret leaving is the form's, not the user's —
    // which is the fault 260906-at-create-dialog-blur-from-autofocus corrects,
    // and this guard had encoded the same wrong precondition.
    input.focus();
    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    const said = refusal(host);
    console.log(`refusal after visiting and leaving the field: ${JSON.stringify(said)}`);
    expect(said, "a field the user visited and left empty must say so").not.toBe("");
  });
});
