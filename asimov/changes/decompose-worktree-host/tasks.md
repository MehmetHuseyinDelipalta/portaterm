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

- [x] 2_15 Extract the folder picker — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
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

- [x] 2_16 Extract the create itself — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_15
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create/submitArm.ts` is under 500 lines, and `src/providers/worktreeHost/actions/create.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/submitArm.ts` with the create and retry arms (`worktreeCreate`, `worktreeSetupRetry`), moving them out of `src/providers/worktreeHost/actions/create.ts`. `MigrationOffer` moves to `src/providers/worktreeHost/hostTypes.ts`: the submit reads and deletes the offer, `requestWorktreeCreateDefaults` mints it, so neither arm's file owns the type; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/submitArm.ts` and split `src/providers/worktreeHost/actions/create/submitArm.ts` again if it fires.

- [x] 2_17 Extract what a freshly opened form is told — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_16
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/actions/create.ts` and every file under `src/providers/worktreeHost/actions/create/` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/providers/worktreeHost/actions/create.ts` for direction B.
    2. Create `src/providers/worktreeHost/actions/create/defaultsArm.ts` with the defaults arm (`requestWorktreeCreateDefaults`) and `src/providers/worktreeHost/actions/create/refsArm.ts` with the refs arm (`requestWorktreeRefs`), moving them out of `src/providers/worktreeHost/actions/create.ts`. One file for both came to 498 lines with `shape` still firing, and only one of the two arms establishes an opening; former `let` bindings become accessor functions and their negation sites are checked by hand (D4).
    3. Trim the destructures and imports the cut leaves unused in `src/providers/worktreeHost/actions/create.ts`.
    4. Run `bun run asm refactor shape src/providers/worktreeHost/actions/create.ts src/providers/worktreeHost/actions/create/defaultsArm.ts` and split `src/providers/worktreeHost/actions/create/defaultsArm.ts` again if it fires.
    5. Record `wc -l` for `src/providers/worktreeHost/actions/create.ts` and every file under `src/providers/worktreeHost/actions/create/` in workflow.md Notes.


## 3. `actions/provision.ts` — the asks


- [x] 2_18 Extract the copy-file and setup-step asks — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
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

## 4. `WorktreeHost.ts` — the composition root itself

D1 kept the wiring, the returned object and `dispose` in the root. After twelve
cuts that root is still 739 lines, because each extracted module costs the root a
`createXxx({...})` call the design's arithmetic did not carry. The goal binds at
500, so two more cuts land: the returned object's mutation-service answers, and
the create-form cluster's own wiring.

- [x] 2_19 Extract what the mutation service asks the host — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_18
  - **Refs**: None
  - **Boundary**: `src/providers/worktreeHost/mutationSupport.ts` is under 500 lines, and no behaviour changes
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a).
    2. Create `src/providers/worktreeHost/mutationSupport.ts` with the `mutationBindings()` answer — `forceRebuild`, `resolve`, `repoPath`, `migrationRegistration`, `observation`, `createContext`, `assessRemoval` — moving it out of `src/providers/WorktreeHost.ts`. The types module `mutationBindings.ts` that `2_1` split out for the same consumer stays where it is; this is its implementation.
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Run `bun run asm refactor shape` on both and answer what fires.

- [x] 2_20 Extract the create-form cluster's wiring — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts exit 0
  - **Deps**: 2_19
  - **Refs**: None
  - **Boundary**: `src/providers/WorktreeHost.ts` is under 500 lines, and every file under `src/providers/worktreeHost/` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 519-case net is unchanged.
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a).
    2. Create `src/providers/worktreeHost/composeCreateSurface.ts` holding the per-opening maps and the modules only the create conversation reads — the offer store, `provisionOffers`, `openingLifecycle`, `openingRegistry`, `destinationResolve` and the four action groups — returning the bundle the root wires the router and the delivery to.
    3. Trim the destructures and imports the cut leaves unused in `src/providers/WorktreeHost.ts`.
    4. Record `wc -l` for `src/providers/WorktreeHost.ts` and every file under `src/providers/worktreeHost/` in workflow.md Notes.
    5. Run design.md OBL-4's BOTH diff forms, `&&`-joined, and OBL-5's command verbatim.

- [x] 2_21 Re-point the one-owner structural test at the module that now owns the sweep — verified: pnpm exec vitest run src/worktree/provisioning/oneOwner.test.ts exit 0
  - **Deps**: 2_20
  - **Refs**: None
  - **Boundary**: the test's CLAIM is unchanged — one bulk owner, every flat state map swept exactly once, in one routine rather than per repository. Only the file it reads and the form it matches move.
  - **Acceptance**:
    - Outcome: `pnpm run test:unit` is green, and the re-pointed assertion still fails against a per-repository helper.
    - Verify: command pnpm exec vitest run src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/oneOwner.test.ts` reads `src/providers/WorktreeHost.ts` for `forgetDepartedRepos`; task `2_7` moved that routine to `src/providers/worktreeHost/openingRegistry.ts` and the seven-suite net could not see it. Point the read at the new owner.
    2. The sweep is no longer spelled `[...map.keys()]` inline — `openingRegistry` owns one `sweep(slots, drop)` and the departure routine calls it once per map. Match the call, not the inlined scan, and keep the eight maps and their order.
    3. Re-point the negative control at the same form, so a per-repository helper still fails it.
    4. Widen `DESTINATION_CONFLICT_SOURCES` to the whole `src/providers/worktreeHost/` tree: it named `WorktreeHost.ts` to catch a second implementation there, and the code that could carry one has moved under that directory.
