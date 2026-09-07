# Proposal: decompose-worktree-view

## Why

The webview side of the worktree panel is two god-classes:

- `WorktreeController` holds 1582 of its file's 1904 lines across 76 members — 83%
  against `asm refactor shape`'s 60% bar. It is the whole client: create flow, agent
  launches, mutation results, tree reconciliation and visibility, in one class.
- `WorktreeView` holds 1282 of 1486 across 69 members — 86%. It is the whole render:
  the tree, the row memo, the filter, the selection, the ceiling clock and every dialog
  it opens.
- `worktreeView/actionNotices.ts` (622) has the third shape — `createActionNotices` is
  323 lines, 52% of its module.

Change A already extracted `foldState.ts` and `keyboardNav.ts` from the view and
`dialogChannels.ts` from the controller, so the seam is proven here specifically, not
only in the series.

## Scope

- `src/webview/worktree/WorktreeController.ts` (1904) → under 500.
- `src/webview/worktree/WorktreeView.ts` (1485) → under 500.
- `src/webview/worktree/worktreeView/actionNotices.ts` (622) → under 500.
- Every file extracted from those three is also under 500.

## Non-goals and must-nots

- **No behaviour change.** Not the render signature, not the memo key, not the order in
  which a push reaches the view.
- **The regression net is not touched** — the seven suites stay byte-identical
  (design.md OBL-4). A cut that needs a test edited is the wrong cut.
- **No new abstraction.** The seam is the series' settled one: a collaborator per
  responsibility, constructed by the class, which stays as the facade.
- **`worktreeView/` siblings already under 500 are left alone** — `keyboardNav.ts`
  (272), `foldState.ts` (198), and `controller/dialogChannels.ts` (110).

## Appetite

12 tasks: six collaborators out of the controller, five out of the view, one out of
`actionNotices.ts`. Each is a move plus its verification, and each ends green.

## Risk

| Risk | Why it is bearable here |
|---|---|
| The view's per-worktree DOM memo is a performance prototype whose key must cover every field its listeners read | The memo key and the render that consumes it move together in one task, never apart |
| The controller's create flow spans nine message handlers that share a pending-create record | They move as ONE collaborator for that reason; splitting them by message type is what would break it |
| Two classes, both touched by the same suites | The suites run in seconds, and the two classes are cut in separate tasks so a failure names which |
