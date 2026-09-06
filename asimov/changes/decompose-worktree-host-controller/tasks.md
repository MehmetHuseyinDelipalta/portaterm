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

- [ ] 1_2 Extract the create-dialog sinks and pin the live-token builders
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D3
  - **Boundary**: all seven outbound `onXxx` request builders keep their existing token expression — do not generalise them
  - **Acceptance**:
    - Outcome: the eight `apply*` fields are gone, and a superseded opening's switch, save and authorize name the current token.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts src/webview/worktree/controller/dialogChannels.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/controller/dialogChannels.ts` holding the eight sinks — defaults, provisioning, migration, pullRequests, refs, resolution, debrisAuthorization, destinationPicked — with `bind`, `push` and `clear` per channel; `destinationPicked` keeps its `{ opening, apply }` pairing.
    2. Replace the eight `private apply*` fields at `src/webview/worktree/WorktreeController.ts:362-395` with one `dialogChannels` member.
    3. Point the eight `bindXxx` callbacks at 553-647 at the collaborator's `bind`, leaving all seven sibling `onXxx` builders in that literal byte-identical.
    4. Point the consumption sites at 971, 1292, 1315, 1334, 1350, 1377, 1392, 1404, 1448, 1740 and 1752 at the collaborator's `push` and `clear`.
    5. Add `src/webview/worktree/controller/dialogChannels.test.ts`: supersede an opening, then fire switch, save and authorize and assert each request carries the current `refsToken`, not the retired one (design.md OBL-3).
    6. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/dialogChannels.ts`.

## 2. Action modules

- [ ] 2_1 Move the thin action arms into a shell action factory
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Acceptance**:
    - Outcome: the twelve thin arms and `launch` live in `actions/shell.ts` behind an action table; host suites pass.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/shell.ts` exporting `ShellDeps` and `createShellActions(deps)`, with `ShellDeps` naming `surfaces`, `cache`, `perform`, `actionPath`, `matchedRow`, `admittedTarget`, `admissibleLaunch`, `launchOpts`, `options` and `disposed: () => boolean`.
    2. Move the arms for `worktreeOpenFolder`, `worktreeSetupViewOutput`, `worktreeRevealInOS`, `worktreeCopyPath`, `worktreeOpenTerminal`, `worktreeFocusPane`, `worktreeOpenPreview`, `worktreeCopyResumeCommand`, `worktreeRevealAgentCwd`, `worktreeCopyAgentPath`, `worktreeLaunchAgent` and `worktreeResumeHere` into it, plus the `launch` helper at `src/providers/WorktreeHost.ts:4295-4334`, each keeping its guard order and early returns.
    3. In `src/providers/WorktreeHost.ts`, call `createShellActions` once inside `createWorktreeHost` and spread its handlers into the action table that replaces those switch arms.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/actions/shell.ts`; neither may fire `long-function`.

- [ ] 2_2 Move the removal arms and repair the fs-deletion gate's scan set
  - **Deps**: 2_1
  - **Refs**: design.md D1, design.md D3, design.md D2
  - **Acceptance**:
    - Outcome: `gate:fs-deletion` fails on a planted deletion inside the extracted removal module.
    - Verify: command pnpm run gate:fs-deletion
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/removal.ts` exporting `RemovalDeps` and `createRemovalActions(deps)`, naming `surfaces`, `cache`, `perform`, `actionPath`, `repoIdOf`, `admitAssess`, `options` and `disposed: () => boolean`.
    2. Move the arms for `worktreeRemoveAssess`, `worktreeRemove`, `worktreeLock`, `worktreeUnlock` and `worktreePrune` into it, and spread its handlers into the action table.
    3. Extend the scan predicate at `src/test/invariants/fsDeletionGate.ts:47` with `|| rel === "src/providers/worktreeHost/actions/removal.ts"` — the exact path, not a directory prefix (design.md D3).
    4. Plant a temporary `fs.rm` call in `src/providers/worktreeHost/actions/removal.ts`, run `pnpm run gate:fs-deletion`, record that it fails, remove the plant, and confirm it passes (design.md OBL-1).
    5. Run `pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts`.

- [ ] 2_3 Move the provisioning arms and pin baseline identity across detach
  - **Deps**: 2_2
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: no map or cache is copied at the factory boundary — references only
  - **Acceptance**:
    - Outcome: the four provisioning arms live in `actions/provision.ts`, and a detach-reattach on one opening keeps its baseline.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/worktreeHost/actions/provision.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/actions/provision.ts` exporting `ProvisionDeps` and `createProvisionActions(deps)`, naming `offers`, `provisionSwitch`, `provisionBaseline`, `provisionReading`, `addedSteps`, `addedCopyFiles`, `migrationOffers`, `migrationReading`, `surfaces`, `cache`, `previewProvisioning`, `issueWithAdded`, `withoutAdded`, `privateIdsFor`, `perform`, `options`, `disposed: () => boolean` and `bumpMigrationSequence: () => number`.
    2. Move the arms for `worktreeProvisionSwitch`, `worktreeCopyFileAsk`, `worktreeSetupStepAsk` and `worktreeProvisionSave` (`src/providers/WorktreeHost.ts:3338-3753`) into it, and spread its handlers into the action table.
    3. Pass every map and the cache by reference; pass `disposed` and `migrationSequence` as accessor functions, since a `let` binding cannot be shared through an object field (design.md D4).
    4. Add `src/providers/worktreeHost/actions/provision.test.ts`: record a baseline on an opening, detach the surface, reattach on the same opening, and assert the save reports the reattached baseline rather than the stale one (design.md OBL-4).
    5. Run `bun run asm refactor shape src/providers/worktreeHost/actions/provision.ts`.

- [ ] 2_4 Move the create arms and their helpers
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

- [ ] 3_1 Replace the two-map opening representation with a tagged-union reducer
  - **Deps**: 2_4
  - **Refs**: design.md D5, design.md D2
  - **Boundary**: behaviour of every existing opening transition is preserved; this task adds no new message type
  - **Acceptance**:
    - Outcome: the three invalid live/high-water combinations are unrepresentable; full suite green.
    - Verify: command pnpm exec vitest run src/providers/worktreeHost/openingLifecycle.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Create `src/providers/worktreeHost/openingLifecycle.ts` with a tagged union over the three phases — pristine, live, retired — and a module-level reducer over the five events: initial open, repeat, supersede, close, detach reset. No class (design.md D5).
    2. Replace the `liveOpening` and `openingHighWater` maps declared at `src/providers/WorktreeHost.ts:915` and `957` with one map of reducer states, and route `retireOpening` and `forgetSurfaceOpenings` (1126-1231) through the reducer.
    3. Route the close and supersede arms now living in `src/providers/worktreeHost/actions/create.ts` through the same reducer so phase is derived in one place rather than through 20 `liveOpening.get` calls.
    4. Add `src/providers/worktreeHost/openingLifecycle.test.ts` driving all five transitions, including a stale replay and a detach-to-same-token reset, asserting none of the three invalid combinations is constructible (design.md OBL-5).
    5. Run `pnpm run test:unit` and confirm 7947 tests still green.
