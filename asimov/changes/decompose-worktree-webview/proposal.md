# Proposal: decompose-worktree-webview

## Why

`src/webview/worktree/WorktreeView.ts` (2321) and `src/webview/worktree/WorktreeCreateDialog.ts`
(3873) are the two largest remaining files on the worktree axis after
`decompose-worktree-host-controller` took `WorktreeHost.ts` from 5225 to 2718. They are the two
the user named next.

`asm refactor shape` reads them differently, and the cuts follow that rather than the line counts.

- `WorktreeView.ts` → **god-class**: 1837 of 2321 lines in one class, 90 members, 76 of them
  private. The remedy the shape names is extract-collaborators-keep-a-facade, and the class has
  three clusters that are collaborators already in everything but name.
- `WorktreeCreateDialog.ts` → **long-function** on a 2802-line closure factory. That is the SAME
  percentage artifact `decompose-worktree-host-controller` recorded: a closure-factory module
  fires `long-function` at any size, because the heuristic measures the largest body as a share
  of the file. Moving DOM code out of it would not answer the shape and would not make the file
  easier to reason about either. What is actually tangled there is that the form's ANSWER state —
  fifteen `let` bindings the closure keeps live — is only readable by running the DOM.

## Scope

- Extract three collaborators out of `WorktreeView`: keyboard navigation, action notices, and
  fold state. Each gets its own tests; `WorktreeView` keeps its public surface and becomes their
  facade.
- Extract the create dialog's headless answer model, so the draft, the branch choice and the
  derivation flags can be driven and asserted without a DOM.

## Non-goals

- **Must not** change `src/types/messages.ts`.
- **Must not** change any existing assertion. Retargeting a private-field poke to a new seam is
  allowed and is recorded in design.md; weakening one is not.
- **Must not** split `WorktreeCreateDialog.ts` by DOM section. The rendering is not the tangle.
- **Must not** chase `asm refactor shape` into silence. Both files stay closure/class-shaped and
  will keep firing their percentage heuristic; the deliverable is separated responsibility with
  tests on the new seams, and the shape output is recorded, not worked around.
- Out of scope: the `providers/worktreeHost/actions/create.ts` read/commit split (owns the
  inherited round-1 F002 backlog item) and `src/worktree/worktreeMutationService.ts`. Both are
  named in the user's goal and follow as their own changes.

## Appetite

Five tasks, each a single extraction with its own test, each committed separately.

## Risk

The webview suites run under jsdom. Per `asimov/project.md`, a task whose Verify names a jsdom
suite MUST declare `Verify: command pnpm exec vitest run <path>` — `unit <path>` runs under
`bun test`, which cannot load them, and three failed attempts lock the task.
