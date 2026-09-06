## 1. Independent extractions

- [x] 1_1 Extract the inbound message shape predicates out of the host closure — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.test.ts exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Acceptance**:
    - Outcome: `WorktreeHost.ts` no longer declares the shape predicates; host suites pass unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/messageGuards.ts` and move `namedOpening` (`src/providers/WorktreeHost.ts:929-930`) into it as an exported function.
    2. Move the 13 declarations at `src/providers/WorktreeHost.ts:1994-2301` — `onlyKeys`, `isKnownCreateMode`, `isKnownProvision`, `isKnownMigration`, `isKnownSetupRetry`, `isKnownSetupOutput`, `isKnownDeleteBranchRequest`, `isKnownSwitch`, `isKnownSave`, `isKnownCopyFileAsk`, `isKnownStepAsk`, `isKnownDisposition`, `isKnownAfterCreate` — into that file as `export function` declarations, bodies unchanged.
    3. Add explicit parameter and return types where the host closure previously supplied inference (design.md D4).
    4. Import the moved names back into `src/providers/WorktreeHost.ts`; `namedOpening` keeps its five call sites at 2947, 3771, 3788 and 4055, and every `liveOpening` comparison stays as written.
    5. Run `bun run asm refactor shape src/providers/worktreeHost/messageGuards.ts` and confirm no shape fires.

- [x] 1_2 Extract the create-dialog sinks and pin the live-token builders — verified: pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts src/webview/worktree/controller/dialogChannels.test.ts exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D3
  - **Boundary**: all seven outbound `onXxx` request builders keep their existing token expression — do not generalise them
  - **Acceptance**:
    - Outcome: the eight `apply*` fields are gone, and a superseded opening's switch, save and authorize name the current token.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts src/webview/worktree/controller/dialogChannels.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/controller/dialogChannels.ts` holding the eight sinks — defaults, provisioning, migration, pullRequests, refs, resolution, debrisAuthorization, destinationPicked — with `bind` and `push` per channel and no `clear`: the eight fields are never set back to null today, so a closed form's sink stays bound and safety comes entirely from the token guard in each `handleXxx`. `destinationPicked` keeps its `{ opening, apply }` pairing behind a push that fires only for a matching opening.
    2. Replace the eight `private apply*` fields at `src/webview/worktree/WorktreeController.ts:362-395` with one `dialogChannels` member.
    3. Point the eight `bindXxx` callbacks at 553-647 at the collaborator's `bind`, leaving all seven sibling `onXxx` builders in that literal byte-identical.
    4. Point the consumption sites at 971, 1292, 1315, 1334, 1350, 1377, 1392, 1404, 1448, 1740 and 1752 at the collaborator's `push`.
    5. Add `src/webview/worktree/controller/dialogChannels.test.ts`: supersede an opening, then fire switch, save and authorize and assert each request carries the current `refsToken`, not the retired one (design.md OBL-3).
    6. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/dialogChannels.ts`.

## 2. Action modules

- [x] 2_0 Extract the host types the action modules share — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D2
  - **Boundary**: types move only — no behaviour, no new field on any of them
  - **Acceptance**:
    - Outcome: the action-facing host types resolve from one module; host suites pass unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/hostTypes.ts` and move `WorktreeSurface`, `AdmittedLaunch` and `LaunchTargetRecord` into it from `src/providers/WorktreeHost.ts`, exporting each.
    2. Move `WorktreeActions` and `WorktreeHostOptions` into the same module, since every action factory's `Deps` names `WorktreeActions`.
    3. Re-export `WorktreeSurface`, `WorktreeActions` and `WorktreeHostOptions` from `src/providers/WorktreeHost.ts` so no existing importer changes.
    4. Confirm no import cycle: `hostTypes.ts` imports nothing from `WorktreeHost.ts`.

- [x] 2_1 Move the thin action arms into a shell action factory — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts exit 0
  - **Deps**: 2_0
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Acceptance**:
    - Outcome: the twelve thin arms and `launch` live in `actions/shell.ts` behind an action table; host suites pass.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/shell.ts` exporting `ShellDeps` and `createShellActions(deps)`, with `ShellDeps` naming `surfaces`, `cache`, `perform`, `actionPath`, `matchedRow`, `admittedTarget`, `admissibleLaunch`, `launchOpts`, `options` and `disposed: () => boolean`.
    2. Move the arms for `worktreeOpenFolder`, `worktreeSetupViewOutput`, `worktreeRevealInOS`, `worktreeCopyPath`, `worktreeOpenTerminal`, `worktreeFocusPane`, `worktreeOpenPreview`, `worktreeCopyResumeCommand`, `worktreeRevealAgentCwd`, `worktreeCopyAgentPath`, `worktreeLaunchAgent` and `worktreeResumeHere` into it, plus the `launch` helper at `src/providers/WorktreeHost.ts:4295-4334`, each keeping its guard order and early returns.
    3. In `src/providers/WorktreeHost.ts`, call `createShellActions` once inside `createWorktreeHost` and spread its handlers into the action table that replaces those switch arms.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/actions/shell.ts`; neither may fire `long-function`.

- [x] 2_2 Move the removal arms and repair the fs-deletion gate's scan set — verified: pnpm run gate:fs-deletion && pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D1, design.md D3, design.md D2
  - **Acceptance**:
    - Outcome: `gate:fs-deletion` fails on a planted deletion inside the extracted removal module.
    - Verify: command pnpm run gate:fs-deletion
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/removal.ts` exporting `RemovalDeps` and `createRemovalActions(deps)`, naming `surfaces`, `cache`, `perform`, `actionPath`, `repoIdOf`, `admitAssess`, `options` and `disposed: () => boolean`.
    2. Move the arms for `worktreeRemoveAssess`, `worktreeRemove`, `worktreeLock`, `worktreeUnlock` and `worktreePrune` out of `src/providers/WorktreeHost.ts` into it, and route those cases through the action table.
    3. Extend the scan predicate at `src/test/invariants/fsDeletionGate.ts:47` with `|| rel === "src/providers/worktreeHost/actions/removal.ts"` — the exact path, not a directory prefix (design.md D3).
    4. Plant a temporary `fs.rm` call in `src/providers/worktreeHost/actions/removal.ts`, run `pnpm run gate:fs-deletion`, record that it fails, remove the plant, and confirm it passes (design.md OBL-1).
    5. Run `pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts`.

- [x] 2_3 Move the provisioning arms and pin baseline identity across detach — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/worktreeHost/actions/provision.test.ts exit 0
  - **Deps**: 2_2
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: no map or cache is copied at the factory boundary — references only
  - **Acceptance**:
    - Outcome: the four provisioning arms live in `actions/provision.ts`, and a detach-reattach on one opening keeps its baseline.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/worktreeHost/actions/provision.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/provision.ts` exporting `ProvisionDeps` and `createProvisionActions(deps)`, naming `offers`, `provisionSwitch`, `provisionBaseline`, `provisionReading`, `addedSteps`, `addedCopyFiles`, `migrationOffers`, `migrationReading`, `surfaces`, `cache`, `previewProvisioning`, `issueWithAdded`, `withoutAdded`, `privateIdsFor`, `perform`, `options`, `disposed: () => boolean` and `bumpMigrationSequence: () => number`.
    2. Move the arms for `worktreeProvisionSwitch`, `worktreeCopyFileAsk`, `worktreeSetupStepAsk` and `worktreeProvisionSave` out of `src/providers/WorktreeHost.ts` into it, and route those cases through the action table.
    3. Pass every map and the cache by reference; pass `disposed` and `migrationSequence` as accessor functions, since a `let` binding cannot be shared through an object field (design.md D4).
    4. Add `src/providers/worktreeHost/actions/provision.test.ts`: record a baseline on an opening, detach the surface, reattach on the same opening, and assert the save reports the reattached baseline rather than the stale one (design.md OBL-4).
    5. Run `bun run asm refactor shape src/providers/worktreeHost/actions/provision.ts`.

- [x] 2_4 Move the create arms and their helpers — verified: pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Acceptance**:
    - Outcome: `WorktreeHost.ts` holds no action bodies; full suite green at 7947 tests.
    - Verify: command pnpm run test:unit
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/create.ts` exporting `CreateDeps` and `createCreateActions(deps)`.
    2. Move the arms for `worktreeCreate`, `requestWorktreeCreateDefaults`, `worktreeCreateProbe`, `worktreeAuthorizeDebris`, `worktreePickDestination`, `worktreeCreateClosed`, `requestWorktreeRefs` and `worktreeSetupRetry`, keeping each one's `namedOpening` and `liveOpening` guard order exactly as written.
    3. Move the create helpers at `src/providers/WorktreeHost.ts:2429-2917` with them — `pickDestination`, `answerCreateProbe`, `resolveBranchVerdict`, `resolveBaseVerdict`, `isWellFormedProbe`, `isWellFormedBase`, `dispositionOf`, `answerDebrisAuthorization`, `corroborate`, `corroborateAdopt` (design.md D1).
    4. Confirm `src/providers/WorktreeHost.ts` retains only state construction, projection, publish, delegation and the action table.
    5. Run `bun run asm refactor shape src/providers/WorktreeHost.ts` and every file under `src/providers/worktreeHost/`; no shape may fire.

## 3. Pattern

- [x] 3_1 Replace the two-map opening representation with a tagged-union reducer — verified: pnpm exec vitest run src/providers/worktreeHost/openingLifecycle.test.ts src/providers/WorktreeHost.actions.test.ts exit 0
  - **Deps**: 2_4
  - **Refs**: design.md D5, design.md D2
  - **Boundary**: behaviour of every existing opening transition is preserved; this task adds no new message type
  - **Acceptance**:
    - Outcome: the three invalid live/high-water combinations are unrepresentable; full suite green.
    - Verify: command pnpm exec vitest run src/providers/worktreeHost/openingLifecycle.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/openingLifecycle.ts` with a tagged union over the three phases — pristine, live, retired — and a module-level reducer over the five events: initial open, repeat, supersede, close, detach reset. No class (design.md D5).
    2. In `src/providers/WorktreeHost.ts`, replace the `liveOpening` and `openingHighWater` maps with one `createOpeningLifecycle()` store, and route `retireOpening` and `forgetSurfaceOpenings` through it.
    3. Route the arms in `src/providers/worktreeHost/actions/create.ts` and `src/providers/worktreeHost/actions/provision.ts` through the same store, so phase is derived in one place rather than through 20 `liveOpening.get` calls.
    4. Add `src/providers/worktreeHost/openingLifecycle.test.ts` driving all five transitions, including a stale replay and a detach-to-same-token reset, asserting none of the three invalid combinations is constructible (design.md OBL-5).
    5. Run `pnpm run test:unit` and confirm 7947 tests still green.

## 4. Review

- [x] 4_1 Close round-1 findings — verified: pnpm run gate:fs-deletion exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D1, design.md D3
  - **Acceptance**:
    - Outcome: F001, F003 and F005 are closed in code and F004 in the record; the I10 gate fails on a planted deletion in `src/providers/worktreeHost/actions/create.ts`.
    - Verify: command pnpm run gate:fs-deletion
  - **Plan**:
    1. Add `src/providers/worktreeHost/actions/create.ts` to the stated list in `src/test/invariants/fsDeletionGate.ts`, saying why the debris-authorization mint belongs there (F001).
    2. In `src/providers/worktreeHost/actions/create.ts`, replace `CreateDeps.surfaces` with `hasSurface(surface): boolean`, matching `RemovalDeps` and `ProvisionDeps`, and update the wiring in `src/providers/WorktreeHost.ts` (F003).
    3. Correct the module header of `src/providers/worktreeHost/actions/provision.test.ts` to name `actions/create.ts` as the baseline writer (F005).
    4. Amend `asimov/changes/decompose-worktree-host-controller/design.md` D3 to record that one retarget changed `toBeDefined()` to `toBe(true)`, and why that strengthened a vacuous precondition (F004).
