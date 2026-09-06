# Design: decompose-worktree-host-controller (refactor: src/providers/WorktreeHost.ts + src/webview/worktree/WorktreeController.ts)

## Diagnosis

| | |
|---|---|
| Target | `src/providers/WorktreeHost.ts` · `src/webview/worktree/WorktreeController.ts` |
| Lines at start | 5225 · 1932 |
| Shape | `long-function` · `god-class` (from `asm refactor shape`) |
| Because | host: `createWorktreeHost` 4418 lines = 85% of statements (bar 25%) · controller: class holds 1609/1933 lines = 83% across 96 members (bar 60%) |
| Direct tests | **NONE for `handleAction`** — all 26 host entry points construct `createWorktreeHost`; the controller's 3 entry points go through `WorktreeController.mount`. The net is a black-box suite at the factory/mount boundary, which cannot couple to the internals being rearranged. |
| Why now | Caller asked to decompose the worktree axis after a >1K-LOC scan; both files are the landing site for worktree fixes (128 and 91 commits). |

## Decisions

### D1: Target structure

A cut lands where the behaviour it owns lands. Each action module declares the host bindings
it needs as an explicit `Deps` interface and is created once per host; the host closure stays
the only place those bindings are constructed.

```
src/providers/
  WorktreeHost.ts              # composition root: state construction, projection, publish, action table
  worktreeHost/
    messageGuards.ts           # shape predicates over inbound messages — no host state
    openingLifecycle.ts        # tagged-union reducer for opening phase (task 3_1 only)
    actions/
      shell.ts                 # reveal / copy / open / focus / launch — the 12 thin arms
      removal.ts               # assess, remove, lock, unlock, prune
      provision.ts             # switch, copy-file ask, setup-step ask, save
      create.ts                # create, create-defaults, probe, refs, debris, destination
src/webview/worktree/
  WorktreeController.ts        # facade: subscription, query, view state
  controller/
    dialogChannels.ts          # the 8 create-dialog sinks and their lifecycle
```

Left in `WorktreeHost.ts` on purpose: the closure that declares and constructs every mutable
binding, the projection and publish machinery (`projectOnce`, `requestProjection`,
`ensureProjection`, `publishLaunchTargets`), delegation (`requestDelegations`), and the action
table that routes messages to the created handlers.

Left in `WorktreeController.ts` on purpose: subscription level, query, view data, and the whole
`WorktreeViewDeps` literal — the controller legitimately owns wiring its own view.

**Shape: factory per module, not a parameter object.** `handleAction` reads far more than state:
`options` (19 uses), `perform` (18), `disposed` (14), `actionPath` (9), `matchedRow` (6),
`repoIdOf` (5), `issueWithAdded` (5), `previewProvisioning` (3), plus `admitAssess`,
`admittedTarget`, `admissibleLaunch`, `launch`, `launchOpts`, `withoutAdded`, `privateIdsFor`.
Each module therefore exports `createXxxActions(deps: XxxDeps)`, called once inside
`createWorktreeHost`, and returns the handlers for its message types. Maps and the cache pass as
references; the two mutable scalars pass as accessors — `disposed: () => boolean` and
`bumpMigrationSequence: () => number` — because a `let` binding cannot be shared through an
object field. This is the shape the file already has (everything is a closure over the factory),
so each task is a move rather than a rewrite, and it gives every module a seam that can be
tested directly — which is what retires the "no direct test" risk below.

No `HostState` parameter object is introduced: it would be a ~25-field argument that only
relocates the closure.

Clusters ordered by coupling ascending. `Deps` = host-closure bindings the cluster reads today.

| # | Cluster | Lines | LOC | Deps | Technique | Task |
|---|---|---|---|---|---|---|
| 1 | message guards | 929-930, 1994-2301 | ~310 | 0 | extract pure functions | `1_1` |
| 2 | dialog channels | 362-395, 553-647, 1292-1448 (controller) | ~120 | 0 | extract collaborator | `1_2` |
| 3 | shell actions | 2924-2936, 4181-4294, 4295-4334 | ~180 | 9 | factory per module | `2_1` |
| 4 | removal actions | 3182-3266, 4172-4180 | ~130 | 8 | factory per module | `2_2` |
| 5 | provision actions | 3338-3753 | ~415 | 14 | factory per module | `2_3` |
| 6 | create actions | 2429-2917, 2937-3181, 3754-4171 | ~1150 | 20 | factory per module | `2_4` |
| 7 | opening lifecycle | 915-1231, 3754-3839 | ~200 | 4 | tagged-union reducer (D5) | `3_1` |

Cluster 1 is 13 functions — `onlyKeys`, `isKnownCreateMode`, `isKnownProvision`,
`isKnownMigration`, `isKnownSetupRetry`, `isKnownSetupOutput`, `isKnownDeleteBranchRequest`,
`isKnownSwitch`, `isKnownSave`, `isKnownCopyFileAsk`, `isKnownStepAsk`, `isKnownDisposition`,
`isKnownAfterCreate` — plus `namedOpening` (929-930), which they call four times and which is
itself pure. Independently confirmed capture-free: the guards reference only `onlyKeys` and
`namedOpening`, no other closure binding.

Cluster 6 carries the create *helpers* as well as the arms: `pickDestination` (2429),
`answerCreateProbe` (2520), `resolveBranchVerdict` (2723), `resolveBaseVerdict` (2742),
`isWellFormedProbe` (2766), `isWellFormedBase` (2794), `dispositionOf` (2818),
`answerDebrisAuthorization` (2829), `corroborate` (2878), `corroborateAdopt` (2897). Leaving
them behind would contradict `2_4`'s outcome. Cluster 3 likewise takes `launch` (4295-4334).

Deliberately not cut: `assessLanes`, `rosters`, `watches` — independently confirmed to have zero
references inside `handleAction`, so they stay host-closure locals. `WorktreeCreateDialog.ts` and
`worktreeMutationService.ts` are out of scope (proposal.md § Non-goals).

**What cluster 2 does not touch.** Only the eight `bindXxx(apply)` sinks are extracted. **Seven**
outbound request builders in the same literal stay exactly as written, because their token source
is not uniform and the difference is load-bearing:

| builder | line | token |
|---|---|---|
| `onSelectionChange` | 518-551 | live `this.refsToken` |
| `onProvisionSwitch` | 565-575 | live `this.refsToken` |
| `onProvisionSave` | 608-619 | live `this.refsToken` |
| `onAuthorizeDebris` | 633-635 | live `this.refsToken` |
| `onCopyFileAsk` | 580-586 | captured `opening` |
| `onSetupStepAsk` | 591-601 | captured `opening` |
| `onPickDestination` | 641-644 | captured `opening` |

Unifying them is the defect commits `405f9c77` and `86df1b30` were fixing. The existing suite pins
the captured half only (`WorktreeController.test.ts:2102-2156`, `2205-2226`); the live half is
unpinned, which OBL-3 now funds a test for.

### D2: Preservation proof

| | |
|---|---|
| Suite command | `pnpm run test:unit` |
| Baseline | **7947 tests / 311 files** green at `a3d2416e`, type-check clean |

Per-task Verify uses `pnpm exec vitest run <path>`, never `unit <path>`: all three target
suites need `vi.fn` or jsdom, and `asm change verify-task` runs `unit` under `bun test`, where
they fail wholesale (project.md).

Rules every task obeys:

- Baseline suite green after every task. The count is a tripwire — a drop, or a test-file edit
  not predeclared in D3/D4 or the task's Plan, stops the task: revert, never adjust a test to fit.
- `src/types/messages.ts` is frozen, and every task ends with `git diff --exit-code -- src/types/messages.ts`.
  Checking only at the last task would let an edit made early and reverted late pass unseen (OBL-2).
- Growth is additive only; extracted units get tests before the next cut.
- Re-run `asm refactor shape` after each cluster on the target **and every destination it wrote
  to** — a cut that leaves `WorktreeHost.ts` short but fires `long-function` on `actions/create.ts`
  has moved the defect, not removed it.
- The same step failing twice means the seam is wrong, not the edit — stop and re-plan.
- `pnpm run test:unit` is load-flaky under peer sessions (project.md). A single red run on
  `src/extension.worktreeAssembly.test.ts` is re-run once before it is treated as a regression;
  a red run anywhere else is not.

### D3: Expected test moves

Mechanical only. No assertion changes anywhere.

- `src/test/invariants/fsDeletionGate.ts`: line 47's scan predicate gains
  `|| rel === "src/providers/worktreeHost/actions/removal.ts"`. The exact path, not a directory
  prefix: the gate is deliberately a stated list rather than a repository-wide `fs.rm` rule
  (`fsDeletionGate.ts:36-41`), and a prefix would pull `messageGuards.ts`, `actions/create.ts`,
  `actions/provision.ts` and `actions/shell.ts` into scope for no reason. Not a test move — a
  **scope repair**, see OBL-1. No assertion changes.
- No other test file moves. The host and controller suites address their targets through
  `createWorktreeHost` and `WorktreeController.mount`, both of which keep their signatures, so
  no import path in any existing test changes.

Additive test growth, funded by the refuted ledger rows — new files, no edits to existing ones:

- `src/webview/worktree/controller/dialogChannels.test.ts` (`1_2`) — pins the live-token half of
  D1's table: supersede an opening, fire switch / save / authorize, assert the CURRENT token rides.
- `src/providers/worktreeHost/actions/provision.test.ts` (`2_3`) — pins `provisionBaseline`
  continuity across detach and reattach onto the same opening.

### D4: Allowed non-pure transformations

- `1_1`: guards become `export function` declarations and gain explicit parameter types where
  the closure previously supplied inference. Behaviour-preserving: the predicates are total over
  their input and have no branches on captured state.
- `2_1`-`2_4`: each extracted arm keeps its existing early-return structure and guard order; a
  `switch` arm becomes a named function. Maps and the cache pass as references, never copies;
  `disposed` and `migrationSequence` pass as accessor functions because a `let` cannot be shared
  through an object field.
- `3_1`: the reducer replaces the two-map representation. This is the one task whose proof is
  tests on a new seam rather than the baseline suite surviving a move (D5).

### D5: Pattern after extraction

`Tagged-union opening reducer` — pain: the opening lifecycle is represented as two parallel maps,
`liveOpening` (`WorktreeHost.ts:915`) and `openingHighWater` (`957`), with mutation split across
`retireOpening`/`forgetSurfaceOpenings` (1126-1231) and the close/supersede arms (3754-3839).
It grows along the *states* axis: 3 semantic phases (pristine, live, retired) and 5 events
(initial open, repeat, supersede, close, detach reset), with phase inferred through 20
`liveOpening.get` calls rather than held in one place.

Must beat — a status field plus independent numeric fields: that construct still admits the same
3 categorically invalid states the two maps admit today (live present with high-water absent;
both present with live below high-water; both present with live above high-water) and still
duplicates the transition mutation across the two sites above. The reducer makes those three
unrepresentable.

Reuse: NONE — `src/session/TrackedCommand.ts:58-78` is a domain-specific reducer, not a reusable
opening lifecycle, and no generic state-machine dependency is installed.

Proof: tests on the new seam exercising all 5 transitions and asserting that a stale or replayed
opening, and a detach-to-same-token reset, cannot produce any of the 3 invalid combinations.
Stays a module-level reducer over a tagged union — no class.

## Obligation ledger

Every row below was `refuted` by the plan attack in its first form. The claims are restated to
what a witness can establish, and two rows fund a new test rather than lean on a suite that was
shown not to pin them.

| id | claim | semantics | defeater | witness / check | disposition |
|---|---|---|---|---|---|
| OBL-1 | The relocated removal module stays inside the fs-deletion gate's scan set | `fsDeletionGate`'s stated list includes `src/providers/worktreeHost/actions/removal.ts` after `2_2` | `worktreeRemove` moves out of `src/providers/WorktreeHost.ts`, which `fsDeletionGate.ts:47` matches by exact string, so the new file is unscanned and the gate passes vacuously | X: plant an `fs.rm` in `actions/removal.ts`, run `pnpm run gate:fs-deletion`, record the failure, remove the plant, confirm it passes — catches "gate no longer covers extracted removal code". Task `2_2`. | supported |
| OBL-2 | The extension↔webview wire contract is unchanged | `src/types/messages.ts` is byte-identical at **every** task boundary | An edit lands in an early task and is reverted before the final one, so a single end-of-change check passes while the obligation was violated | X: `git diff --exit-code -- src/types/messages.ts` as the closing step of every task, `1_1` through `3_1` — catches a protocol edit at the boundary where it happens. | supported |
| OBL-3 | Each of the seven outbound builders keeps its own token source | The four live-`refsToken` and three captured-`opening` builders in D1's table each send the same expression after `1_2` as before | `1_2` generalises the builders alongside the sinks and picks one token source; the existing suite compares requests only within one unchanged opening (`WorktreeController.test.ts:4196-4218`, `4267-4283`), so switching the live three to captured survives it | X: new `dialogChannels.test.ts` — supersede an opening, then fire switch / save / authorize and assert the request names the CURRENT token; catches the live→captured mutation the existing suite misses. Task `1_2`. | supported |
| OBL-4 | No host binding is copied when it crosses a module boundary | Every map and the cache reach an action factory as the same object reference for the life of one host | A factory's `Deps` is built with `new Map(existing)`; cleanup then mutates the closure's map while the handler reads the copy — an unchanged save reports `tookSource: true` after detach and reattach onto the same opening | X: new `provision.test.ts` — detach a surface, reattach on the same opening, assert the provisioning baseline is the reattached one; catches identity loss on `provisionBaseline`, which the baseline tests never detach for (`WorktreeHost.actions.test.ts:4614-4708`). Task `2_3`. | supported |
| OBL-5 | The opening reducer admits no invalid phase combination | For every reachable sequence of the 5 transitions, no state satisfies live-without-high-water, live<high-water, or live>high-water | The reducer is introduced but the three combinations remain constructible through a transition that writes one field without the other | X: `openingLifecycle.test.ts` drives all 5 transitions including stale replay and detach-to-same-token, asserting the invalid trio is unrepresentable — catches a transition that updates one field only. Task `3_1`. | supported |

Out of scope, recorded rather than fixed: `fsDeletionGate` is not transitive — `src/extension.ts:1603-1619`
is on the production removal path and outside the scan set today. That is a pre-existing property of
the gate, not something this change introduces; repairing it is its own change.

## Risk Map

| Risk | Mitigation |
|---|---|
| `handleAction` has no direct test — a wrong seam surfaces as behaviour, not a compile error | Retired by D1's shape: each `createXxxActions(deps)` is a seam that can be addressed directly, and `1_2`/`2_3`/`3_1` add tests on those seams. Until then: every step is a move, not a rewrite (D4), `tsc` plus the 9 host suites, one action group per task with the suite green between each. |
| Extracted `actions/*.ts` inherits `long-function` — the defect moves instead of leaving | D2 requires `asm refactor shape` on every destination, not just the source. `create.ts` is the exposure: 227 + 248 lines from two cases. |
| The suite was shown not to pin two properties it was assumed to pin (OBL-3, OBL-4) | Both now fund a new test on the new seam rather than relying on the baseline. Neither test edits an existing file. |
| Cluster 6 is ~1150 lines including 10 create helpers — by far the largest single move | Ordered last, onto a file three cuts smaller. Its arms and helpers move together (D1) so no create behaviour is left behind. |
| I10 gate silently descopes (OBL-1) | Negative check: prove the gate fails on a planted deletion in the new path before accepting `2_2`. |
| Load-flaky assembly suite reads as a regression | D2's re-run rule, scoped to `extension.worktreeAssembly.test.ts` only. |
