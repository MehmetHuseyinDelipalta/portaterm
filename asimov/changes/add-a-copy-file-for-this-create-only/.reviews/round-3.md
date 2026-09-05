# Review Round 3: add-a-copy-file-for-this-create-only

**Date**: 2026-09-05
**Cycle**: 2
**Mode**: verification
**Scope**: range `b57225ef..00e1fcbb`
**Head**: `00e1fcbb9d44a6a7d9d012854b8bc53cd3ae82aa` (working tree dirty outside the reviewed range; those edits were excluded)
**Reviewable lines**: 93
**Agents spawned**: `asm-review-performance`, `asm-review-reuse`, `asm-review-contracts`
**Agents skipped**: `asm-review-data-security` (no picker, source-authority, or external-input boundary changed), `asm-review-logic` (F002's bounded-state cone was assigned to performance and inspected by the chair), `asm-review-frontend` (no webview code changed)
**Verdict**: **WARN**
**Counts**: 0 BLOCK, 1 WARN, 0 SUGGEST; 3 fixed prior findings; 1 audit-backlog entry

## Verification scope and lock

The delta contains only remediation for accepted F002-F004, their focused tests, review persistence, and task-completion metadata. It adds no new capability, contract semantics, design decision, or invariant owner, so the verification scope lock passes. Current dirty changes to analytics, `AgentHookController.test.ts`, and `worktreeFormat.ts` were excluded.

Verification covered the prior witnesses and exactly their behavioral cones:

- F002: repository departure -> repository-scoped offer/provision/opening/migration retirement -> holder disposal -> sibling repository remains usable.
- F003: provider destination-conflict rule -> shared providerKit owner -> suggested and picked admission callers -> structural one-owner guard.
- F004: offer resolution -> private-aware `redeem` -> selection, current/superseded/unknown/foreign refusal, forget, and forget-surface semantics.

## Remediation trace

### Repository departure

A whole-tree rebuild snapshots repository ids before applying the rebuilt tree, computes `before - live`, and passes that set to `forgetDepartedRepos`. For every attached surface and departed repository, `retireRepository` deletes the exact provisioning-read key; sweeps switch, baseline, setup, and picked-copy slots using a repo-id-safe last-separator parse; disposes every unclaimed picked holder; forgets only that surface/repository offer; deletes only that repository's opening; and removes matching migration reads/offers. It does not delete `liveOpening`, `openingHighWater`, or sibling repository records. The new host witness admits a holder, removes that repository, observes disposal, then issues and spends a fresh picker ask for the sibling repository.

### Destination-conflict ownership

`conflictsWithProvisionDestination` now owns the exact `identityOf` plus `contendersOf` predicate in `providerKit`. Both `suggestProvisioning` and both WorktreeHost picked-file admission sites call it. The structural test scans shipped provisioning sources plus WorktreeHost, expects only `providerKit.ts` to contain the implementation shape, proves the matcher catches a copied implementation, and proves it ignores a caller of the helper.

### Offer resolution contract

`ProvisionOfferStore.lookup` is removed from the interface and implementation, and an exact-head production search finds no remaining caller. The migrated tests exercise model selection, current identity, supersession, unknown ids, cross-surface and cross-repository refusal, monotonic non-reuse, `forget`, `forgetSurface`, and ordinary empty held-file sidecars through `redeem`.

## Verification evidence

`bun run asm change verify-status add-a-copy-file-for-this-create-only` records task 6_1 passing its focused host, suggestion, offer-store, and one-owner suite, followed by type checking and the full unit suite. The supplied fix-delta audit records 518 focused witnesses and 7,889 full-suite witnesses passing, together with TypeScript, Biome, bundle, surviving-require, and I10 gates. Review did not rerun project verification commands.

## Findings

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- class: feature
- file: src/providers/WorktreeHost.ts:991
- title: Departed repositories retain their held-copy records
- evidence: The prior witness is closed by `retireRepository` at `src/providers/WorktreeHost.ts:1126-1173`, invoked for the exact `before - live` departed set at lines 4824-4830. It disposes the departed repository's holder records and removes its offer/provision/opening/migration state without retiring sibling repositories. The new test at `src/providers/WorktreeHost.actions.test.ts:9138` observes holder disposal and a subsequent sibling pick.
- impact: The departed repository no longer consumes unusable global holder capacity or retains private provisioning authority.
- suggestedFix: None; retain the repository-scoped retirement witness.
- status: fixed
- triage: FIXED. Every boundary in F002's inventory is retired for the departed repository, while the shared surface opening and sibling repository remain live.
- outcome: fixed in `6daa89c9`.

### F003

- ID: F003
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-reuse
- class: feature
- file: src/providers/WorktreeHost.ts:1012
- title: Provisioning destination conflicts now have two owners
- evidence: The duplicate WorktreeHost and suggestion implementations are gone. `src/worktree/provisioning/providerKit.ts:475` is the sole predicate owner; WorktreeHost and `suggestProvisioning` call it. `src/worktree/provisioning/oneOwner.test.ts:59-87` includes owner enumeration plus positive violating and negative caller fixtures.
- impact: Suggested-file and picked-file admission now share one destination identity/fold rule.
- suggestedFix: None; retain the non-vacuous structural guard.
- status: fixed
- triage: FIXED. The prior duplicate mechanism no longer exists and the source-level invariant has a test that can fail for a copied implementation.
- outcome: fixed in `6daa89c9`.

### F004

- ID: F004
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-contracts
- class: machinery
- file: src/providers/WorktreeHost.ts:2960
- title: Migrating every consumer to redeem leaves lookup as dead contract surface
- evidence: `lookup` is absent from the exact-head interface, implementation, production source, and tests. The migrated `offerStore.test.ts` cases preserve the prior scope, expiry, selection, and forgetting witnesses through `redeem`, including ordinary offers with an empty private sidecar.
- impact: Offer resolution now has one private-aware contract and no model-only alternative that can discard sidecar provenance.
- suggestedFix: None.
- status: fixed
- triage: FIXED. `redeem` is the sole production and test resolution path, with the old refusal and lifecycle semantics retained.
- outcome: fixed in `6daa89c9`.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance
- class: feature
- file: src/providers/WorktreeHost.ts:1566
- title: Repository departure performs quadratic full-map cleanup scans
- evidence: `forgetDepartedRepos` invokes `retireRepository` once for every departed repository on every surface. Each invocation then fully scans `provisionSwitch`, `provisionBaseline`, `addedSteps`, `addedCopyFiles`, `migrationReading`, and `migrationOffers` at lines 1137-1170. These maps grow with surface/repository state, and repository count has no structural cap; removing D of R repositories therefore repeats whole-map work D times rather than sweeping each map once.
- impact: A whole-tree rebuild that removes many repositories can perform quadratic synchronous cleanup on the extension host before projection and delivery complete. The ordinary small-workspace path is correct, but large multi-root churn can visibly stall it.
- suggestedFix: Sweep each state map once using the departed-id set and live surface keys, or store repository-scoped state in structured surface/repository buckets so each departed bucket is removed directly. Preserve the sibling-survival and holder-disposal witness.
- status: accepted
- triage: ACCEPTED. This is a new performance regression inside F002's remediation cone: correctness is restored, but the cleanup repeats unbounded full-map scans per departed repository.

## Adjudication

F002-F004 are fixed at their invariant boundaries. No gating blocker remains, so round-3 Arbiter Mode was not entered. F005 is a non-gating WARN inside the verification cone; it does not reopen F002 because the holder and authority cleanup is correct, but it prevents an APPROVE verdict under the ordinary verdict rule.

## Audit backlog

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- class: feature
- file: src/webview/worktree/worktreeFormat.ts:30
- title: Backslash spinner frames are no longer recognized
- evidence: The unrelated dirty working-tree edit changes `^[|/\\-]\s+` to `^[|/-]\s+`, omitting the documented backslash frame.
- impact: Backslash spinner decoration remains visible and defeats render-signature suppression on that tick.
- suggestedFix: Restore the backslash member and add formatter/render-signature witnesses in the separate change that owns this edit.
- status: audit-backlog
- triage: AUDIT BACKLOG. Outside both reviewed committed ranges and untouched by this remediation. Owner: the change that introduced the dirty `worktreeFormat.ts` edit. Reactivation trigger: a review range that includes that edit or any change to spinner-decoration parsing.

## Specialist question responses

- Performance confirmed F002 is fixed across holder, offer, provisioning, opening, and migration state while siblings remain live; it found F005 in the cleanup implementation.
- Reuse confirmed F003's duplicate is gone and the structural matcher is non-vacuous.
- Contracts confirmed F004 is fixed and all prior offer-store selection/refusal/forget semantics remain exercised through `redeem`.
