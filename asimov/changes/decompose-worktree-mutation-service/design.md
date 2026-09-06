# Design: decompose-worktree-mutation-service

## Target

`src/worktree/worktreeMutationService.ts` — 1852 lines; `createWorktreeMutationService` is 1177 of
them (`:585-1761`, 64% of statements). Four mutable stores and eleven service members in one closure.

Measured before planning, so the cut follows the code rather than the line count:

```
712-1749  const service = {                      the object; :1750-1760 is the disposal wrapper
  724       reconcileFingerprints    (14)  ┐
  821       issueFingerprint          (8)  ├─ removal assessment, over the fingerprint store
  829       assessRemovalReport      (16)  ┘
  738       retrySetup               (83)  ─── the rotating one-shot authority
  845       issueDebrisAuthorization (25)  ─── stays: a wrapper over a store that is already a module
  870/875   lock / unlockWorktree     (10)
  880       removeWorktree          (179)  ─── holds 5 of the 9 fingerprint-store reads
  1059      pruneRepo                (39)
  1098      createWorktree          (654)
              1123-1231  adopt       (109)  ┐  create NOTHING — they register a checkout
              1241-1338  reattach     (98)  ┘  already on disk
              1340-1747  create      (408)  ─── stays: two-phase, heavy closure capture
```

Ranges corrected after the plan attack: `createWorktree` closes at `:1748`, the service object at
`:1749`, and the file's last line is 1852.

## D1 — Target structure

```
src/worktree/worktreeMutationService.ts    # facade: deps, the service object, create-proper,
                                           # the debris store, pruneRepo, lock/unlock, `settled`
  mutationService/
    setupExecution.ts       # failedSetup, portEnvironment, executeSetup, writeManifest,
                            # the retry store + retryKey + newSetupRetryId, retrySetup,
                            # registerRetry (create-proper's publisher) and forgetAbsent
    removal.ts              # the fingerprint store, assess, issueFingerprint,
                            # assessRemovalReport, removeWorktree, forgetAbsent
    registerExisting.ts     # the adopt and reattach branches, with recordFor,
                            # holdsStaleRegistration, liveHolderOf, adoptDeclineReason,
                            # declineReason, residueNote
```

#### Contract

Each module is a factory `createXxx(deps)` returning named handlers, the seam both archived changes
established. A `let` that becomes an accessor is rewritten at every site.

## D1a — Why `removeWorktree` moves after all

The plan attack refuted its exclusion. `fingerprints` has nine readers and five of them are inside
`removeWorktree` (`:895`, `:944`, `:948`, `:992`, `:1048`) — it issues, redeems and forgets. Leaving
it in the facade while the assessment members leave would give one store two owners across a module
boundary, which is the exact leak this cut exists to remove. So the module is `removal.ts` and it
owns the store: assessment and removal are one responsibility, not two.

#### Contract

The facade holds no reference to `fingerprints`. Every read and write of it goes through `removal.ts`.

## D1b — `reconcileFingerprints` is two reconciliations

Its body walks BOTH stores: fingerprints at `:726-729` and setup retries at `:731-735`. It cannot
move to either module whole. Each module exposes `forgetAbsent(presentWorktreeIds)` over its own
store, and the facade's `reconcileFingerprints` member calls both.

#### Contract

Neither module reads the other's store. The facade sequences them and owns nothing itself.

## D2 — Why adopt and reattach share one module

They are two operations, not one — their guards differ and the source comments are explicit that
neither may inherit the other's. But they share the same seam (`recordFor`, `holdsStaleRegistration`
/ `liveHolderOf`, `lstat`/`isDirectory`/`isSymbolicLink`/`normalize`, `deps.listWorktrees`,
`deps.afterCreate`) and the same claim: this create writes an administrative entry for a directory
that already exists. Splitting them into two files would put that shared seam in a third.

#### Contract

`registerExisting.ts` exports two named handlers, `adopt` and `reattach`. Neither calls the other.

## D3 — Why the retry store, its key and its id minting move together

`retrySetup` spends the capability by ROTATING it — `held.retryId = newSetupRetryId()` at `:745`,
before queueing, so a double click cannot enqueue the same authority twice. The one-shot property is
the conjunction of three things: the map, the key function, and the minting function.

The plan attack found the first draft of this decision unexecutable: `setupRetries` is written from
three sites OUTSIDE `retrySetup` — the reconciliation at `:733` (D1b), and create-proper at `:1730`
(delete) and `:1739` (mint-and-insert). "The facade holds no reference" is only reachable if the
module offers create-proper a way to publish an authority, so it does.

#### Contract

`setupExecution.ts` owns `setupRetries`, `retryKey` and `newSetupRetryId`. The facade holds no
reference to any of the three. Create-proper publishes through one member that performs `:1730` and
`:1739` as a unit and RETURNS the minted id (or `null` when the incarnation or path no longer
matches), so the id is minted where the map is.

## D4 — Allowed non-pure transformations

Verbatim moves wherever possible. Where not:

- A closure variable read by both the facade and a moved body becomes an accessor function passed in
  `deps`. TypeScript flags `x ||` and `if (x)` (TS2774) but **NOT** `!x &&`, which silently reads
  truthy — so every negated site is checked by hand, not by the compiler.
- `fail(message)` is constructed per-request inside `createWorktree` (`:1099-1104`). The moved
  branches receive it rather than rebuilding it, so the reported `verb`/`repoId` cannot drift.
- `settled` (`:710`) is pure — `(verb, repoId, result)` in, an outcome out, no closure. So is `paths`
  (`:1638`). Both go to `mutationService/outcomes.ts` and are imported, never copied.
  **Corrected after build (.reviews/round-1.md F004):** this first read "it is read by reattach and by
  removal, so it is lifted to module scope in the facade". Two errors. `settled` is read by reattach
  and by the facade's lock, unlock, prune and create — never by removal, which classifies with
  `asOutcome` because a removal has a third answer (`indeterminate`) a git result does not, and did
  not read it at `ef96ea01` either. And module scope in the facade is unavailable: removal.ts and
  registerExisting.ts are imported BY the facade, so importing a value back is a runtime cycle. A leaf
  module that imports only types is what resolves it. The sharing that justifies the module is real —
  `paths` between removal and the facade, `settled` between registerExisting and the facade — so the
  boundary stands on corrected premises.
- `openFailure` (`:1112`) is a `let` in `createWorktree` that the moved branches read.
  **Corrected after build:** it becomes a LOCAL in each handler, not the accessor pair written here.
  Every read and write of it is inside one branch's coordinator body, and both branches return before
  create-proper resumes, so it was never shared state in fact — only in scope. An accessor pair would
  have manufactured a coupling the code does not have. Its `=== null` sites move unchanged, so D4's
  negation rule has no site here to apply.

## D5 — What does NOT move

- **create-proper** (`:1340-1747`). Its two-phase structure is a real seam, but the body captures ~20
  closure variables and the phases are load-bearing for a race the comments describe. Follow-up.
- **`issueDebrisAuthorization`** (25 lines) and `clearDebrisDeps`. The store is already its own
  module; a second wrapper is a file, not a boundary. The comment at the `clearDebrisDeps`
  declaration records why it is the module's own and not assembled from `pathDeps` (round-1 B4) —
  that reason is about synchronous probing and does not travel.
- **`pruneRepo`** (39). A single coordinator run over `deps` holding no state of its own; extracting
  it would move lines without moving ownership. `removeWorktree` was excluded on the same reasoning
  and the plan attack refuted it — see D1a.

## Obligation ledger

Rewritten after the plan attack. Two rows were `unresolved` on their first wording because they cited
the EXISTING suite as their whole witness and it does not cover the claim; one was `refuted` because
the closing command the tasks actually ran was vacuous. What replaced them is narrower.

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | a setup retry authority stays one-shot and target-scoped | after the cut, one `retryId` admits at most one queued retry, and only for the repo AND worktree it was issued against | two separate ones. The rotation: the minting function stays in the facade while the map moves, so nothing rotates and the same id is spendable twice. The scoping: `retryKey` (`:601`) drops `repoId`, so an authority issued for repo A is spendable against repo B — every existing retry test uses one repo, so none of them moves | `X: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts` for the rotation — `:3397-3448` spends `retry-1` twice and independently requires one retirement, two total setup runs and one provisioning report, so dropping the rotation at `:745` yields a third run and fails it. `X: pnpm exec vitest run src/worktree/mutationService/setupExecution.test.ts` for the scoping — spends an authority issued for repo A against repo B and asserts refusal; catches the `retryKey` mutation, which the existing suite cannot see | supported |
| OBL-2 | an adoption or repair carrying a debris clearance is refused BEFORE its branch runs | for both modes the handler returns without reaching `deps.corroborateAdopt` / `deps.corroborateRepair` or any coordinator run | the guard moves past the corroboration but before the write — after `:1283` for reattach, after `:1168` for adopt. The existing tests assert only the error message and the absence of the final git call (`worktreeMutationService.test.ts:1611-1616`, `:1894-1895`), so both mutations pass them | `X: pnpm exec vitest run src/worktree/mutationService/registerExisting.test.ts` — asserts the corroboration dependency was NEVER CALLED, for both modes. An assertion on the reported message is what leaves the mutation alive, so the witness is the call count and not the text | supported |
| OBL-3 | the I10 gate actually READS the new modules | the scanned-module count rises from 70 to 74 (three modules at the time of writing, four once 1_2 added `outcomes.ts`) | the gate passes unchanged because a module it never enumerated cannot fail it — `pnpm run gate:fs-deletion` reports "ok" either way, and "ok" is what a silent scope loss looks like | `X: pnpm run gate:fs-deletion` — it builds a Program from `parsed.fileNames` (`src/test/invariants/fsDeletionGate.ts:190-200`) and selects non-test production files under `src/worktree/` by prefix (`:43-63`); `tsconfig.json` sets no narrow `include`, so an unimported new module is still enumerated. Production modules only: `:44-45` excludes tests, so the four new production files count and their four suites do not. The check is the count, not the verdict | supported |
| OBL-4 | `src/types/messages.ts` is unchanged across the whole change | byte-identical between the change's base commit and the tree | the pair `git diff --exit-code $(git rev-parse HEAD)..HEAD` the first draft prescribed expands to `HEAD..HEAD` and passes on a COMMITTED protocol edit — vacuous, and it is the form the tasks would have run | `X: git diff --exit-code ef96ea01..HEAD -- src/types/messages.ts && git diff --exit-code -- src/types/messages.ts` — the base sha written literally, never re-derived from `HEAD` at run time | supported |

### What the attack changed in the plan

- **D3 was unexecutable.** `setupRetries` is written from three sites outside `retrySetup`; "the
  facade holds no reference" needed a publishing member that create-proper calls, which D3 now names.
- **`reconcileFingerprints` cannot move whole** — it reconciles two stores (D1b), so task 1_1 taking
  it would have left task 1_2 mutating a store another module already owned.
- **`removeWorktree`'s exclusion was refuted** — five of the nine fingerprint reads are inside it
  (D1a). It moves, and the module is `removal.ts`.
- **OBL-4's closing command was vacuous** in all three tasks; the base sha is now literal.
- **Ranges corrected**: create-proper `:1340-1747`, member closes `:1748`, object `:1749`, file 1852.
- **`settled` and `openFailure`** were omitted from the move set task 1_3 needs (D4).

## Risk Map

- `asm refactor shape` will still read the facade `long-function` after the cut — `createWorktree`
  alone is 654 lines and create-proper 413 of them. Record the output, do not chase it.
- `pnpm run test:unit` is load-flaky in `src/extension.worktreeAssembly.test.ts` (project.md). A
  single failure there is not this change until it reproduces.
- `Verify: unit <path>` runs under `bun test` and cannot run this suite. Every task declares
  `Verify: command pnpm exec vitest run <path>`.
