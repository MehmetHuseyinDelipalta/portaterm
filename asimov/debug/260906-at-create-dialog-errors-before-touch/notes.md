# 260906-at-create-dialog-errors-before-touch

Reported: "mở create worktree dialog; tên vẫn empty; click vào bất kì checkbox/button nào thì
lập tức báo lỗi => chỉ nên báo lỗi khi out focus thôi"

## Root cause

`syncDerived` in `src/webview/worktree/WorktreeCreateDialog.ts` computed `blockedBy` on every
render, including the first, from `named` alone — whether the branch field currently holds text.
Nothing in that expression distinguished "the user emptied this field" from "this form has just
opened", so the message that names the empty field was written into the disabled-reason element
before the user had any chance to type, and re-asserted on every subsequent render.

## What the verified run showed

The click is not the trigger, and the finding is stronger than the report. A probe clicked all
three checkboxes and all five buttons on a production-shaped form: `Enter a branch name.` is
already in the DOM snapshot taken at open, and no click changed it. The one click-driven change
is `Detach at a ref instead`, which swaps it for `Enter a ref to detach at.` — a second sentence
of the same kind, about a second untouched field.

So the form was naming an empty field from the moment it opened. The click is simply when the
user looks down and reads it, and every click re-renders, which is why it feels click-driven.

`syncDerived` computed `blockedBy` on the first render with no notion of whether the user had
been in the field yet. `nameLeft` / `baseLeft` now gate only the SENTENCE: Create stays disabled
throughout, because the guard was never the complaint. `blur` on the field is what turns its
emptiness into the user's answer, and ⌘↵ — the one way to ask for a create while the button is
disabled — marks both, so the form says what it is waiting for instead of sitting inert.

A refusal about text the user DID type is untouched: `heldBy`, the host's `branchValid` verdict
and `deps.validateBranch` all still speak immediately. Only the empty-and-unvisited case waits.

## What it did not settle

- I could not reproduce the reported transition (quiet → error on click), because there is none
  in this build. If the reporter saw a message appear rather than one they had not noticed, it
  was the Detach swap, which is now gated on the same rule.
- `deps.validateBranch` has no production caller — only tests pass it. The red `.wt-ferror` path
  is therefore reachable in production only through the host's `branchValid`, which fires on a
  settled branch edit. Worth knowing before anyone treats that field as live validation.

## Which defensive layer should have caught this

A test. The reason table already covered every message this form can show, and two of its cases
(`missing branch`, `missing detached ref`) arranged nothing but an open form — so the suite
asserted the defect as the contract. A table that enumerates messages needs a case for the
precondition each message is EARNED by, not only for its text.

## Sweep

No sibling sites: `Enter a …` prompts and the disabled-reason element exist only in
`WorktreeCreateDialog`. The remove, launch and prune dialogs carry neither.
