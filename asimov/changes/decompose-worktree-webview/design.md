# Design: decompose-worktree-webview (refactor: src/webview/worktree/WorktreeView.ts + WorktreeCreateDialog.ts)

## Diagnosis

`asm refactor shape` at `15571982`:

```
WorktreeView.ts          2321 lines  god-class      class 79% (1837/2321), 90 members, 76 private
WorktreeCreateDialog.ts  3873 lines  long-function  openWorktreeCreateDialog 2802 lines (72%)
```

The two diagnoses are not the same problem wearing different sizes.

`WorktreeView` holds five responsibilities in one class, and three of them touch none of the
other two's state:

```
WorktreeView (facade)
  ├─ render/memo ──────── data, rowMemo, signature, renderRepo, buildWorktree   [stays]
  ├─ dialog openers ───── beginDialog, openCreateDialog … openRemoveReport      [stays]
  ├─ ceiling timer ────── ceilingTimer, armCeiling, nextCeilingCrossing         [stays]
  ├─ keyboard nav ─────── navRows, syncRovingTabindex, keyOf, stampLevels,      → keyboardNav.ts
  │                       depthOf, parentOf, focusRow, onKeyDown, expandOrDescend
  ├─ action notices ───── placeResults, armAutoDismiss, pruneAutoDismiss,       → actionNotices.ts
  │                       groupEndFor, repoAnchorFor, nameFor, buildActionNotice, autoDismiss
  └─ fold state ───────── collapsed, expandedRows, seeded, uncapped, idleSeeded,→ foldState.ts
                          toggleCollapsed, toggleKey, toggleRow, isExpanded,
                          toggleIdleTail, idleTailFolded, pruneStaleState
```

`WorktreeCreateDialog` is one closure. Its tangle is that fifteen `let` bindings hold the form's
ANSWER — what the user has said — and the only way to read any of them is to drive the DOM:

```
draft, choice, choices, forkHead, afterChoice, folderMode,
pathIsDerived, usingChosen, destExact, supplied, pickAsks, pickAsked, activeAt, listOpen, closed
```

`WorktreeCreateDialog.test.ts` is 6864 lines and every assertion in it goes through jsdom.

## Decisions

### D1: Target structure

```
src/webview/worktree/
  WorktreeView.ts             # facade: render, memo, dialogs, ceiling timer
  worktreeView/
    keyboardNav.ts            # roving tabindex + arrow/home/end over the rendered rows
    actionNotices.ts          # placing, naming and auto-dismissing action results
    foldState.ts              # which repos, worktrees and idle tails are folded
  WorktreeCreateDialog.ts     # DOM, wiring, message sends
  createDialog/
    draftModel.ts             # the form's answer, headless
```

#### Contract

- Each new module exports a `createXxx(deps)` factory returning named methods. Deps carry
  references, never copies — the same rule the previous change's OBL-4 established.
- `WorktreeView` keeps every public member it has today (`setData`, `focusWorktree`,
  `selectedWorktree`, `clearSelection`, `setQuery`, `rosterRequests`, `open*Dialog`,
  `openRemoveReport`, `dispose`, `element`). Nothing importing it moves.
- `keyboardNav.ts` receives the host element and callbacks; it reads no `WorktreeViewData`.
- `draftModel.ts` imports nothing from `document`. That is the property its tests rest on.

### D2: Preservation proof

Baseline at `15571982`: **7963 tests / 314 files**.

Rules every task obeys:

- Baseline suite green after every task; a drop stops the task — revert, never adjust a test to fit.
- `src/types/messages.ts` is frozen; every task ends with `git diff --exit-code -- src/types/messages.ts`.
- Growth is additive only; each extracted unit gets its tests in the same task.
- **Verify commands name `pnpm exec vitest run <path>`, never `unit <path>`.** These are jsdom
  suites and `bun test` cannot load them (`asimov/project.md`); getting it wrong burns verify
  attempts and three lock the task.
- `asm refactor shape` is re-run on the target and every destination, and its output is RECORDED,
  not chased. Both targets stay closure/class-shaped and will keep firing their percentage
  heuristic — see the Risk Map.

### D3: Expected test moves

`WorktreeView.test.ts` and `WorktreeCreateDialog.test.ts` reach into private fields in places. A
task that removes a field a test pokes retargets the poke to the new seam and records it here,
with the assertion unchanged. Anything more is a handback.

_(rows appended by each task as they are found)_

### D4: Allowed non-pure transformations

- A captured `let` becomes an accessor function in the new module's deps. **A `let` that reads as
  a boolean must become `x()` at EVERY site**: TypeScript flags `x ||` (TS2774) but NOT `!x &&`,
  which silently reads truthy. This exact mutation cost 33 red tests in the previous change and
  is the first thing each task greps for.
- A `private` method becomes an exported factory method; its body is moved verbatim.
- Doc comments travel with what they document.

### D5: Pattern after extraction

None admitted. The three collaborators and the draft model are plain factories over their own
state — the simpler construct, and nothing in the code yet argues for more.

## Obligation ledger

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | `foldState` holds the SAME sets the class held, by reference | the view's prune path and the render path see one set, not two | `createFoldState` copies a `Set` at the factory boundary; a prune then leaves stale keys visible to render | `X: src/webview/worktree/worktreeView/foldState.test.ts` — prune after wiring, assert the render-side read reflects it; catches a copy at the boundary | unresolved |
| OBL-2 | keyboard navigation still refuses to focus a row that is not rendered | for every key event, the focused row is one `navRows()` returned at that moment | `focusRow` is called with a stale `HTMLElement` captured before a repaint | `X: src/webview/worktree/worktreeView/keyboardNav.test.ts` — repaint between read and key, assert focus lands on a live row; catches a captured row list | unresolved |
| OBL-3 | auto-dismiss timers are cleared for results that are gone | no timer outlives the notice it dismisses | `pruneAutoDismiss` reads a copied results array, so a removed result keeps its timer and fires on a detached node | `X: src/webview/worktree/worktreeView/actionNotices.test.ts` — drop a result, advance the clock, assert no dismiss ran | unresolved |
| OBL-4 | `draftModel` decides the derived path with no DOM | the derivation is a function of the answer state alone | the model reads a DOM value (an input's `.value`, a dataset attribute) so the same answer yields two paths | `X: src/webview/worktree/createDialog/draftModel.test.ts` — run under the node environment, not jsdom; a `document` reference throws | unresolved |
| OBL-5 | `src/types/messages.ts` is unchanged | byte-identical across the range | an edit made early and reverted late passes an end-of-change check | `X: git diff --exit-code -- src/types/messages.ts` as the closing step of every task | unresolved |

## Risk Map

| risk | mitigation |
|---|---|
| A moved `let`-as-boolean silently reads truthy | D4 makes it the first grep of every task; the previous change's 33-test failure is the evidence it is not theoretical |
| `asm refactor shape` still fires on both targets after the cut | Expected and recorded, not chased: `god-class` and `long-function` are percentage heuristics and a facade class or closure factory fires them at any size. The deliverable is separated responsibility with tests, and the absolute numbers are reported |
| A jsdom suite declared as `unit` burns verify attempts | D2 makes `pnpm exec vitest run` mandatory in every Verify line |
| `WorktreeCreateDialog.test.ts` is 6864 lines of DOM-driven assertions | The dialog task moves state only, no rendering; the existing suite is the regression net and must stay green unedited |
