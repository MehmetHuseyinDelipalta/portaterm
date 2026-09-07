# Design: decompose-create-dialog (refactor: src/webview/worktree/WorktreeCreateDialog.ts)

## Diagnosis

| | |
|---|---|
| Target | `src/webview/worktree/WorktreeCreateDialog.ts` |
| Lines at start | 3664 |
| Shape | `long-function` (from `asm refactor shape`) |
| Because | `openWorktreeCreateDialog` is 2690 lines, 73% of statements; bar is 25% |
| Direct tests | `src/webview/worktree/WorktreeCreateDialog.test.ts` — 386 cases, 6864 lines, jsdom |
| Why now | The standing goal: this file and every file cut from it under 500 LOC |

## Decisions

### D1 — Target structure

One rule: a module owns one question the form answers. The facade keeps only the composition — build
the elements, wire the collaborators, return the disposer.

```
WorktreeCreateDialog.ts        ~350   the composition root
  createDialog/
    draftModel.ts        216   (change 2) what the answer IS
    branchChoices.ts     287   (change 2) what the branch box offers
    bringContention.ts  ~200   which provisioning rows collide, and which yield
    bringSummaries.ts   ~290   what a provisioning offer says about itself
    bringRowView.ts     ~225   how one provisioning row is drawn
    provisionState.ts   ~380   pending asks, per-repo tick records, the drawn offer
    provisionView.ts    ~340   drawing the section from the offer
    resolutionAsks.ts   ~300   what the host was asked, and what it answered
    recoverOffer.ts     ~180   the debris clearance offer and its grant
    branchList.ts       ~145   the listbox: which row is active, open, commit
    formFields.ts       ~450   element construction for the form's fields
    hostBindings.ts     ~336   the `deps.bind*` channels
```

Every destination is under 500. `bringModel` is deliberately TWO modules: at 493 it would have had
seven lines of margin, which is not a boundary anyone can hold.

| # | Cluster | Lines | LOC | Capture | Task |
|---|---|---|---|---|---|
| 1 | `bringContention` | 324-449 | ~200 | none | `1_1` |
| 2 | `bringSummaries` | 257-323, 450-749 | ~290 | none | `1_2` |
| 3 | `bringRowView` | 750-974 | ~225 | none | `1_3` |
| 4 | `branchList` | 2777-2921 | ~145 | 6 | `1_4` |
| 5 | `recoverOffer` | 2485-2576, 2921-2996 | ~180 | 9 | `1_5` |
| 6 | `resolutionAsks` | 2447-2745 | ~300 | 11 | `1_6` |
| 7 | `provisionState` | 1686-1830, 1921-1972, 2318-2325 | ~380 | 14 | `1_7` |
| 8 | `provisionView` | 1469-1652, 1973-2131 | ~340 | 12 | `1_8` |
| 9 | `formFields` | 1056-1468 | ~450 | 8 | `1_9` |
| 10 | `hostBindings` | 3328-3664 | ~336 | many | `1_10` |

Ordered by capture ascending: tasks 1_1 to 1_3 are module-level moves with no closure capture at all,
so they carry no seam risk. Everything after invents a deps interface.

### D1a — The rule the plan attack taught

A cluster's boundary is assumed WRONG until its free names are enumerated in BOTH directions:

- what the range reads from outside → the deps interface;
- **what outside reads from the range** → the members the factory must expose.

This change's first shape claimed the provisioning state was read at three call sites. It is read at
~40, from `:1395` to `:3490`. The reverse direction was never checked. Every task's first Plan step is
that enumeration, and a task whose count does not match its D1 `Capture` column stops and re-plans
rather than compiling its way to an answer.

### D2 — Preservation proof

| | |
|---|---|
| Suite command | `pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts` |
| Baseline | **386** tests green at `fe49091f`, type-check clean |

- Baseline green after every task. A drop, or a test-file edit not predeclared in D3, stops the task:
  revert, never adjust a test to fit.
- Growth is additive. Tasks that add a headless module add a suite; tasks that move DOM builders the
  386-case suite already drives through `openWorktreeCreateDialog` do not — a second assertion of the
  same markup proves nothing. Which is which is stated per task, not assumed.
- Re-run `asm refactor shape` on the target and every destination after each task.
- The same step failing twice means the seam is wrong — stop and re-plan.

### D3 — Expected test moves

None. `openWorktreeCreateDialog` keeps its signature and its behaviour, so no existing case changes.
Tasks ADD suites beside the modules named in D2.

### D4 — Allowed non-pure transformations

- `let` bindings a collaborator owns become accessor functions; elements it writes into arrive as
  accessors.
- **The negation trap**: TypeScript flags `x ||` and `if (x)` when `x` becomes a function (TS2774) but
  NOT `!x &&`, which silently reads truthy on a function value. Every negated site in a moved body is
  checked by hand, not left to the compiler.
- A module imported BY the facade must not import a VALUE back from it — a runtime cycle. Type-only
  imports erase and are fine.
- Tasks `1_1`-`1_3`: import lists only. No body may change.

## Obligation ledger

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | an added-item tick record stays repository-scoped | a tick set on repo A is re-applied on returning to A, and never applied to repo B | `recordOrdinalTick` / `applyAddedTicksFor` (`:1775`, `:1788`, `:1815`, `:1820`) drop `draft.repoId` and use one shared vector | `X: pnpm exec vitest run src/webview/worktree/createDialog/provisionState.test.ts` — A→B→A with identical added-row ordinals and different tick vectors. A plan attack enumerated every added-item case (`:6347-6858`) and every multi-repo case (`:3238-3324`, `:6462-6496`, `:6747-6774`): none combines the two, so the mutation survives all 386 | supported |
| OBL-2 | a reminted offer carries the user's previous choices, ticks AND unticks | after an answering save/step/copy redraw, an item the user unticked under the old ids is still unticked under the new ones, matched by descriptor | `carryForward` (`:575-611`) is applied to ticks only, so an untick silently reverts to the row's default on the next answer | `X: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts` — `:3040-3078` already requires ticks to survive reminting; `provisionState.test.ts` adds the untick half, which that case does not assert | supported |
| OBL-3 | the provisioning model modules reach no DOM | `bringContention.ts` and `bringSummaries.ts` run under the node environment, where `document` is undefined | a `document` reference creeps in and passes unnoticed under the dialog suite's jsdom | `X: pnpm exec vitest run src/webview/worktree/createDialog/bringSummaries.test.ts` — declares NO `@vitest-environment` pragma. `vitest.config.mts:7-40` sets no environment and no match rule, so the vitest default (node) applies and any DOM reference throws. One case states the guarantee; the rest exercise every exported function, since an unexercised one cannot throw | supported |
| OBL-4 | the inherited regression net is not weakened | `WorktreeCreateDialog.test.ts` is byte-identical to its state at `fe49091f` | a case is relaxed to accommodate a moved body | `X: git diff --exit-code fe49091f -- src/webview/worktree/WorktreeCreateDialog.test.ts` — ONE command, base against the working tree. The two-command form used in changes 2 and 3 (`<base>..HEAD` then a bare `git diff`) has a hole: with a STAGED edit and HEAD at the base, both pass. Verified by experiment, not by reading | supported |
| OBL-5 | the facade holds no reference to moved state | after `1_10`, `WorktreeCreateDialog.ts` contains no occurrence of any `let`/`const` a task moved | a binding is duplicated rather than moved, leaving two owners that drift | `X: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts` plus a per-task grep, recorded in the task's evidence: the moved identifier returns zero hits in the facade | supported |

## Risk Map

- The target's only test drives the whole dialog; there is no unit below `openWorktreeCreateDialog`.
  Mitigation: every step is a move; `tsc` plus the 386-case suite after each task.
- Tasks 1_7 and 1_8 split state and view of one section, and they are mutually referential. If the
  split forces circular deps, they merge into one module and that module is then over 500 — in which
  case the seam is wrong and the task re-plans rather than shipping a 700-line file.
- `asm refactor shape` will still read `long-function` on factory modules. Percentage heuristic; a
  factory is one closure by construction. Changes 1-3 recorded the same and did not chase it.
- Pre-existing and deliberately untouched: `checkedByOffer` is keyed by offer id alone, and no test
  reuses one offer id across two repositories. Follow-up, not this change.
