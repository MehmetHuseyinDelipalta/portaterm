## 1. `WorktreeHost.ts` — one module per question the host answers


- [x] 2_1 Move the host's own contract out of the module that implements it — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: none
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/hostOptions.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/hostOptions.ts` with the `WorktreeHostOptions` and the `WorktreeHost` interface, moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/hostOptions.ts` and split `src/providers/worktreeHost/hostOptions.ts` again if it fires — it fired `type-blob`, so the mutation service's own three (`WorktreeMutationBindings`, `WorktreeMutationReport`, `ResolvedMutationTarget`) go to `src/providers/worktreeHost/mutationBindings.ts`, which is the consumer seam the report was pointing at.
    5. Re-export all of it from `src/providers/WorktreeHost.ts` so no importer changes (D4).

- [x] 2_2 Extract what counts as an admissible agent launch — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_1
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/launchAdmission.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/launchAdmission.ts` with the launch admission and the targets published for it (`offerSeq`, `admissiblePrompt`, `admissibleLaunch`, `admittedTarget`, `publishLaunchTargets`, `launchOpts`) — `offerSeq` is declared among the provisioning state but only this cluster mints from it (OBL-7), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/launchAdmission.ts` and split `src/providers/worktreeHost/launchAdmission.ts` again if it fires.

- [x] 2_3 Extract where a create would land — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_2
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/destinationResolve.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/destinationResolve.ts` with the destination resolution (`createRootFor`, `vettedOverride`, `dispositionOf`, `resolveDestination`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/destinationResolve.ts` and split `src/providers/worktreeHost/destinationResolve.ts` again if it fires.

- [x] 2_4 Extract the removal-assessment queue — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_3
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/assessLanes.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/assessLanes.ts` with the per-repository assess lane (`admitAssess`, `forgetSurfaceAssessments`, `takeNextAssess`, `runAssessLane`, `serveAssess`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/assessLanes.ts` and split `src/providers/worktreeHost/assessLanes.ts` again if it fires.

- [x] 2_5 Extract reading one thing out of the current cache — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_4
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/hostLookups.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/hostLookups.ts` with the cache lookups (`cachedWorktree`, `repoIdOf`, `observationOf`, `repoById`, `launchTarget`, `actionPath`, `matchedRow`, `locate`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/hostLookups.ts` and split `src/providers/worktreeHost/hostLookups.ts` again if it fires.

- [x] 2_6 Extract what the published presence IS — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_5
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/presenceProjection.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/presenceProjection.ts` with the presence projection (`presence`, `rosterKey`, `parentIsLive`, `decay`, `withDelegations`, `publishedRow`) — derivation ONLY; `projected` and `projectedVersion` stay put until `2_11`, their only writer, moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/presenceProjection.ts` and split `src/providers/worktreeHost/presenceProjection.ts` again if it fires.
    5. Expose `presence` as ONE accessor the composition root re-exports, never a copied value (OBL-5).

- [x] 2_7 Extract which question a surface asked — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_6
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/openingRegistry.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/openingRegistry.ts` with the opening registry (`surfaceKey`, `openingKey`, `openingFor`, `retireOpening`, `forgetSurfaceOpenings`, `forgetDepartedRepos`, `surfaceSeq`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/openingRegistry.ts` and split `src/providers/worktreeHost/openingRegistry.ts` again if it fires.
    5. Confirm `dispose`'s `forgetSurfaceOpenings(surfaceKey(surface))` loop at `src/providers/WorktreeHost.ts:2711-2713` still reaches the moved function rather than a facade-local stub (OBL-2).

- [x] 2_8 Extract the provisioning offer a repository is shown — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_7
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/provisionOffers.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/provisionOffers.ts` with the provisioning offers (`previewProvisioning`, `withoutAdded`, `privateIdsFor`, `withAdded`, `roomForOneMoreSetup`, `issueWithAdded`, `currentMigrationRegistration`, `migrationSequence`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/provisionOffers.ts` and split `src/providers/worktreeHost/provisionOffers.ts` again if it fires.

- [x] 2_9 Extract action dispatch and the delegation requests it makes — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_8
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actionRouting.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/actionRouting.ts` with the action routing (`perform`, `handleAction`, `requestDelegations`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/actionRouting.ts` and split `src/providers/worktreeHost/actionRouting.ts` again if it fires.

- [x] 2_10 Extract the timers — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_9
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/scanReconcile.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/scanReconcile.ts` with the scan reconciliation (`armCap`, `arm`, `cancelCap`, `capHandle`, `scanHandle`, `reconcileScan`, `anyShowing`, `anyDrawingRows`, `enrichmentOwed`, `reconcileRowDrawing`, `armScan`, `onPaneChange`, `reconcileWatches`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/scanReconcile.ts` and split `src/providers/worktreeHost/scanReconcile.ts` again if it fires.
    5. `dispose` stays in the composition root and must still cancel both handles through the module — expose a teardown rather than leaving the facade reading a variable nobody writes (OBL-1).

- [x] 2_11 Extract the single-flight projection run — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_10
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/projectionLoop.ts` is under 500 lines, and `src/providers/WorktreeHost.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/projectionLoop.ts` with the projection loop (`projected`, `projectedVersion`, `projectionRun`, `projectionDirty`, `commit`, `worktreeIds`, `projectOnce`, `requestProjection`, `ensureProjection`, `commitAndBroadcast`) — NOT `treeVersion`, which three clusters write and the composition root keeps, moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/projectionLoop.ts` and split `src/providers/worktreeHost/projectionLoop.ts` again if it fires.
    5. The dirty flag and the run move TOGETHER; a flag left behind makes the single-flight loop re-enter. Keep the `disposed` guard around the await (OBL-6) — a read resolving after dispose must write nothing.

- [x] 2_12 Extract what reaches a surface and when — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_11
  - **Refs**: None
  - **Boundary**: `src/providers/WorktreeHost.ts` and every file under `src/providers/worktreeHost/` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/WorktreeHost.ts` for direction B.
    2. Create `src/providers/worktreeHost/surfaceDelivery.ts` with the surface delivery (`deliverable`, `currentMessage`, `postTo`, `deliver`, `broadcast`, `reconcileShowing`, `rebuild`, `attach`, `handleMessage`), moving them out of `src/providers/WorktreeHost.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape src/providers/WorktreeHost.ts src/providers/worktreeHost/surfaceDelivery.ts` and split `src/providers/worktreeHost/surfaceDelivery.ts` again if it fires.
    5. Record `wc -l` for `src/providers/WorktreeHost.ts` and every file under `src/providers/worktreeHost/` in workflow.md Notes. Any file at 500 or above is split before ticking, not deferred.
    6. Confirm OBL-5 by running design.md § Frozen inventory's command verbatim; it must print nothing.
    7. Run design.md OBL-4's BOTH diff forms, `&&`-joined.


## 2. `actions/create.ts` — one module per arm's subject


- [x] 2_13 Extract answering a create probe — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_12
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create/probes.ts` is under 500 lines, and `src/providers/worktreeHost/actions/create.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/probes.ts` with the probe answering (`matchesPublished`, `answerCreateProbe`, `resolveBranchVerdict`, `resolveBaseVerdict`, `isWellFormedProbe`, `isWellFormedBase`), moving them out of `src/providers/worktreeHost/actions/create.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/probes.ts` and split `src/providers/worktreeHost/actions/create/probes.ts` again if it fires.

- [x] 2_14 Extract authorizing a removal at the destination — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_13
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create/debris.ts` is under 500 lines, and `src/providers/worktreeHost/actions/create.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/debris.ts` with the debris authorization (`answerDebrisAuthorization`, `corroborate`, `corroborateAdopt`), moving them out of `src/providers/worktreeHost/actions/create.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/debris.ts` and split `src/providers/worktreeHost/actions/create/debris.ts` again if it fires.

- [ ] 2_15 Extract the folder picker
  - **Deps**: 2_14
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create/destinationPick.ts` is under 500 lines, and `src/providers/worktreeHost/actions/create.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/destinationPick.ts` with the destination pick (`pickDestination`, `worktreePickDestination`), moving them out of `src/providers/worktreeHost/actions/create.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/destinationPick.ts` and split `src/providers/worktreeHost/actions/create/destinationPick.ts` again if it fires.

- [ ] 2_16 Extract the create itself
  - **Deps**: 2_15
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create/submitArm.ts` is under 500 lines, and `src/providers/worktreeHost/actions/create.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/submitArm.ts` with the create and retry arms (`worktreeCreate`, `worktreeSetupRetry`), moving them out of `src/providers/worktreeHost/actions/create.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/submitArm.ts` and split `src/providers/worktreeHost/actions/create/submitArm.ts` again if it fires.

- [ ] 2_17 Extract what a freshly opened form is told
  - **Deps**: 2_16
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create.ts` and every file under `src/providers/worktreeHost/actions/create/` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/defaultsArm.ts` with the defaults and refs arms (`requestWorktreeCreateDefaults`, `requestWorktreeRefs`), moving them out of `src/providers/worktreeHost/actions/create.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/defaultsArm.ts` and split `src/providers/worktreeHost/actions/create/defaultsArm.ts` again if it fires.
    5. Record `wc -l` for `src/providers/worktreeHost/actions/create.ts` and every file under `src/providers/worktreeHost/actions/create/` in workflow.md Notes.


## 3. `actions/provision.ts` — the asks


- [ ] 2_18 Extract the copy-file and setup-step asks
  - **Deps**: 2_17
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/provision.ts` and every file under `src/providers/worktreeHost/actions/provision/` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/provision.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/provision/asks.ts` with the provisioning asks (`worktreeCopyFileAsk`, `worktreeSetupStepAsk`), moving them out of `src/providers/worktreeHost/actions/provision.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/provision.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/provision.ts src/providers/worktreeHost/actions/provision/asks.ts` and split `src/providers/worktreeHost/actions/provision/asks.ts` again if it fires.
    5. Record `wc -l` for `src/providers/worktreeHost/actions/provision.ts` and `src/providers/worktreeHost/actions/provision/asks.ts` in workflow.md Notes.
