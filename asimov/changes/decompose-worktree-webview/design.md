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

Rewritten after the plan attack. Two rows were refuted on their first wording and one witness was
vacuous; what replaced them is narrower and, in two cases, funds a different task.

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | `foldState` is the SOLE owner of the fold sets | after the cut, no path reads `collapsed`/`expandedRows` except through the collaborator | the facade keeps its own copy — it has five direct render-side reads today (`WorktreeView.ts:1170,1299,1411,1429,1541`), and `pruneStaleState` REPLACES both sets (`:930,:948`) rather than mutating them, so a second copy silently stops tracking | `X: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts` — the existing suite is the independent oracle: a retained facade copy means a toggle through the collaborator never reaches render, and the fold assertions go red | supported |
| OBL-2 | keyboard navigation refuses to focus a row that is not rendered | for every key event, the focused row is one `navRows()` returned at that moment | `navRows()` is read at factory construction rather than at event time (`WorktreeView.ts:1984`), leaving focus on a detached row | `X: src/webview/worktree/worktreeView/keyboardNav.test.ts` — wire against one set of rows, replace the host's children, dispatch a key, assert `document.activeElement` is among the REPLACEMENT host's current rows | supported |
| OBL-3 | a dropped result's dismiss timer is cancelled, not merely inert | no `setTimeout` handle outlives the notice it would dismiss | `pruneAutoDismiss` (`WorktreeView.ts:1674-1686`) retains the handle; the callback then finds no live result and dismisses nothing, so "nothing ran" stays true while the timer leaked | `X: src/webview/worktree/worktreeView/actionNotices.test.ts` — assert the `autoDismiss` map holds no entry for the dropped result AND that `vi.getTimerCount()` dropped; observing cancellation, not absence of effect | supported |
| OBL-4 | `draftModel` holds the form's answer with no DOM reference | the module can be loaded and driven under vitest's node environment | the module reads an input's `.value` — destination derivation does exactly this at `WorktreeCreateDialog.ts:3197` and writes `pathInput.value` at `:1457-1504`, which is why that logic is NOT in this cut | `X: src/webview/worktree/createDialog/draftModel.test.ts` with NO `// @vitest-environment` pragma — the root config's default is node and no setup file installs a `document`, so any DOM reference throws | supported |
| OBL-5 | `src/types/messages.ts` is unchanged across the whole change | byte-identical between the change's base commit and the tree | checking `git diff --exit-code -- src/types/messages.ts` alone compares the tree with `HEAD`, so an edit already COMMITTED passes it | `X: git diff --exit-code <base>..HEAD -- src/types/messages.ts && git diff --exit-code -- src/types/messages.ts` where `<base>` is the parent of this change's first commit; catches a committed protocol edit, which the tree-only form cannot see | supported |

### What the attack changed in the plan

- **`pruneStaleState` does not move** (task 1_1). It reads and clears `selectedWorktreeId` and calls
  `deps.onSelectWorktree` (`WorktreeView.ts:917-923`), reconciles `RosterRequests` (`:954`) and calls
  the display policy `isIdleIn` (`:887`). It stays on the facade and calls a fold-only
  `foldState.prune(...)` for its half.
- **`uncapped` does not move** (task 1_1). No method in the cluster operates on it; the facade owns
  it directly at `WorktreeView.ts:1178,1373`.
- **OBL-1's original claim — "the sets cross by reference" — was refuted**, because the prune
  REPLACES both sets. Reference identity was never the property; sole ownership is.
- **Task 2_1 lost the destination derivation.** It reads `nameInput.value` and writes
  `pathInput.value`, so "move the body verbatim into a headless model" was impossible as written.
  The cut is now the answer state alone (`WorktreeCreateDialog.ts:1082-1125` plus `closed`), and the
  derivation stays in the DOM layer reading the model.
- **Task 1_2 gained two sites**: the constructor's `focusin` delegate (`:317-335`) and render
  focus restoration (`:1001-1025`) also own roving focus; moving only the nine methods would split
  that ownership.
- **Task 1_3 gained one**: `dispose` clears the `autoDismiss` map directly (`:745-758`).
- **Every new DOM test needs its own `// @vitest-environment jsdom`** — the pragma is per file and
  the existing suites' does not carry.

## Risk Map

| risk | mitigation |
|---|---|
| A moved `let`-as-boolean silently reads truthy | D4 makes it the first grep of every task; the previous change's 33-test failure is the evidence it is not theoretical |
| `asm refactor shape` still fires on both targets after the cut | Expected and recorded, not chased: `god-class` and `long-function` are percentage heuristics and a facade class or closure factory fires them at any size. The deliverable is separated responsibility with tests, and the absolute numbers are reported |
| A jsdom suite declared as `unit` burns verify attempts | D2 makes `pnpm exec vitest run` mandatory in every Verify line |
| `WorktreeCreateDialog.test.ts` is 6864 lines of DOM-driven assertions | The dialog task moves state only, no rendering; the existing suite is the regression net and must stay green unedited |
