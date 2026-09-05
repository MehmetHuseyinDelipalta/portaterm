# Review Round 2: add-a-copy-file-for-this-create-only

**Date**: 2026-09-05
**Cycle**: 2
**Mode**: discovery
**Scope**: range `fb164483..b57225ef`
**Head**: `b57225ef26007bb0405f9d94c8aa2cae820867d0` (working tree dirty outside the reviewed range; those edits were excluded)
**Reviewable lines**: 675
**Agents spawned**: `asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-performance`, `asm-review-reuse`; support trace by `asm-finder`
**Agents skipped**: none
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 1 WARN, 1 SUGGEST; 1 audit-backlog entry
**Blocker split**: 1 feature / 0 machinery

## Scope correction and accepted obligations

Round 1 reviewed only unrelated dirty working-tree edits. This is a new discovery cycle over the exact committed feature range, with every current working-tree change excluded. F001 remains valid but is outside this range and is carried as non-gating audit backlog; this change must not modify it.

Gate 2 is approved. The review applied D1-D6 and task Acceptance/Refs: extension-owned pathless picker admission; matching resolved containment around an exact no-follow held regular object; global 64-slot and per-opening 32-record bounds; exact entry-object private sidecars reminted to opaque ids; provider/exclusion/contender precedence; compatible reissue retention; every live non-outranked ask answered; Save exclusion based only on private provenance; and synchronous transactional Create claims before any await or form retirement.

## Risk map

- Security boundary: a webview message may select only a repository/opening/sequence, never a source path, holder, or authority marker.
- Filesystem admission: picker pathname resolution, no-follow open, regular-file proof, containment drift, timeout, and late completion.
- Cross-file ownership: one holder moves reservation -> opening record -> offer sidecar -> claimed material -> held stream, with cleanup at every failed handoff.
- Offer consistency: initial read, source switch, copy ask, setup ask, Save reread, stale-offer recovery, and offer reminting must preserve exact private sidecars.
- Ordering/races: copy ask versus switch/Save/setup, Create-before-close, migration re-probe, repeated submission, detach, supersede, host teardown, and repository departure.
- UI state: full-form gate, fresh-offer settlement, copy/setup mutual exclusion, full-record ordinal ticks, focus restoration, optional capability, and secret warning accessibility.
- Growth axes: `addedCopyFiles` per surface/repository/opening (32 records), activation-wide held-file pool (64 charged slots), one current offer per surface/repository, and per-repository pending/tick state in one dialog.
- Reuse: the diff should use the prerequisite holder/offer/material machinery and one shared provisioning-destination collision rule.

## Full-flow trace

### Picker admission

`WorktreeCreateDialog` captures the current offer selection and emits only `{repoId, switch}`; `WorktreeController` adds its compose-time opening; `isKnownCopyFileAsk` rejects extra keys and malformed scalars. `WorktreeHost` resolves the repository from its cache and invokes `pickCopyFile(repo.mainPath)`. The extension-owned picker returns a pathname only to the extension host, which reserves one global pool slot, prepares the resolved root, obtains containment answer A, holds the original pathname with no-follow regular-file admission, obtains answer B, requires A=B, and derives the displayed POSIX path from the authorized canonical answer. Cancellation, failed resolution/open/stat, unsupported no-follow, timeout, drift, and late completion abandon or dispose the holder without publishing authority.

### Record and offer reissues

`addedCopyFiles` stores at most 32 accepted holders per surface/repository/opening. `withAdded` strips prior private rows by the current offer's sidecar ids, composes only the compatible visible record prefix within `MAX_MODEL_ROWS`, and maps each exact new entry object to its canonical path and holder. `offerStore.issue` remints those object-keyed sidecars to opaque ids. Initial read, source switch, copy ask, setup ask, and Save reread all call `issueWithAdded`; presentation fields never grant authority.

### Save and Create

Save redeems the current surface/repository offer, removes every sidecar-backed entry and id before `divergenceOf`, writes only the native configuration divergence, rereads, and recomposes the opening record. Create redeems the same current offer, selects only ids the host model contains, synchronously transaction-claims all selected sidecars, and refuses without dispatch on any partial claim. The claim owner survives the immediately following dialog-close retirement; migration re-probe and create run inside `try/finally`, and both the host and mutation provisioning cleanup are idempotent. Held material reaches `applyProvisioning`/`applyEntries`, which acquires the already-open source stream instead of reopening its pathname.

### Dialog state

A copy ask enters `pendingCopy`, joins the existing form-wide `anyAsking` gate, disables Create/Save/repository/source/setup/copy/destination controls, and states the waiting reason. Only a different offer id settles it. Selection carries by descriptor for provider rows and by dedicated full-record ordinal vectors for host-added setup and copy rows; an appended copy defaults selected. Focus returns to the copy button only when it held focus at the press and no later focus move withdrew restoration.

### Departed repository gap

A whole-tree rebuild calls `forgetDepartedRepos`, but that function deletes only the repository's `openings` enumeration record. It does not retire the new `addedCopyFiles` slot or dispose its holders, even though a pending answer for the same departure is explicitly rejected by `stillMine`. The form and surface can remain live for other repositories, so departed-repository holders continue charging the shared pool until the entire form closes.

## Verification evidence

`bun run asm change verify-status add-a-copy-file-for-this-create-only` records all five tasks passing their focused, type, lint, and full unit-test gates. The changed suites cover pathless routing, resolved-containment and timeout outcomes, private sidecars, provider precedence, all ordinary reissue paths, Save-before-Create, exact held bytes after pathname replacement, transactional claim rollback, form gating, tick carry, focus, accessibility, and close/supersede/detach/host-dispose cleanup. They cover a picker answer that arrives after repository departure, but not an already-admitted record whose repository departs; therefore they do not refute F002.

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
- evidence: The new `addedCopyFiles` map is cleaned only by `retireOpening` at lines 1149-1157. A whole-tree rebuild instead calls `forgetDepartedRepos`, whose departure path at lines 1516-1524 deletes only `openings`. A surface and its create opening remain live while one workspace repository departs, so an already-admitted holder for that repository is neither disposed nor removed. The existing departure test covers only a still-pending picker answer, which `stillMine` rejects; it never admits a record before departure.
- impact: Each orphaned holder continues consuming the activation-global 64-slot pool even though its repository can no longer create from it. Two departed repositories holding 32 picked files each exhaust the pool and make `Add file to copy…` fail for repositories still present until the whole dialog closes. With a malformed sender that consumes claims without posting the normal close, departed per-repository record keys can also accumulate with workspace-history rather than live-workspace size.
- suggestedFix: Add one repository-scoped retirement helper and invoke it from `forgetDepartedRepos`; clear that surface/repository's offer, provision read/switch/baseline/setup/copy slots, dispose every unclaimed added holder, and leave other repositories in the same form live. Add a witness that admits a holder, removes that workspace repository, observes immediate disposal/pool release, and then successfully picks for a remaining repository.
- status: accepted
- triage: ACCEPTED. Repository departure is already an explicit per-repository retirement event for create enumeration, and the new holder-backed state missed that cleanup boundary. The 64-slot cap limits descriptors but does not make retaining unusable slots correct; it turns the leak into deterministic feature exhaustion.

### F003

- ID: F003
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-reuse
- class: feature
- file: src/providers/WorktreeHost.ts:1012
- title: Provisioning destination conflicts now have two owners
- evidence: The new local `conflictsWith` at lines 1012-1017 duplicates the existing predicate in `src/worktree/provisioning/suggestProvisioning.ts:401-407`: both compare `identityOf(candidate.path)` against occupied rows and then ask `contendersOf([...occupied, candidate])` whether the candidate id belongs to a possible-fold group.
- impact: Suggested-file admission and picked-file admission enforce the same destination-collision invariant through independent implementations. A later correction to case/fold or identity semantics can update one path and let the other accept a destination the shared provisioning model rejects.
- suggestedFix: Extract the predicate into the provisioning layer beside `identityOf`/`contendersOf`, consume it from both callers, and protect the one-owner rule with the repository's structural source-matcher pattern rather than claiming a behavioral test can detect identical duplication.
- status: accepted
- triage: ACCEPTED. This is an exact reimplementation of one security-relevant destination-admission rule, not a preference to extract merely similar code.

### F004

- ID: F004
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-contracts
- class: machinery
- file: src/providers/WorktreeHost.ts:2960
- title: Migrating every consumer to redeem leaves lookup as dead contract surface
- evidence: This range changes both production offer consumers from `offers.lookup(...)` to `offers.redeem(...)` at Create and Save. At `b57225ef`, `ProvisionOfferStore.lookup` remains exported and implemented in `src/worktree/provisioning/offerStore.ts:72,179`, but an exact-head production search finds no caller.
- impact: The internal offer-store contract now exposes two resolution operations although only the sidecar-aware one participates in production, leaving dead surface that can mislead a future caller into dropping private provenance.
- suggestedFix: Remove `lookup` and its implementation, retaining `redeem` as the single production offer-resolution contract; update its focused tests accordingly.
- status: accepted
- triage: ACCEPTED. The dead surface is a direct consequence of this range replacing its final consumers, not an unrelated pre-existing cleanup request.

## Adjudication notes

- Dropped the data/security suggestion that consumed records outlive Create claims: the legitimate UI posts Create and immediately retires the opening in `WorktreeView.ts:620-627`, while the transferred claim survives record retirement and all failure paths fail closed.
- Dropped the contracts suggestion about `privateIdsFor` reference equality: every current call site passes either the exact current offer model or a genuinely fresh provider model, so no present behavior fails; documenting hypothetical future misuse is not a finding.

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
- triage: AUDIT BACKLOG. Valid but outside `fb164483..b57225ef`; this change must not modify it. Owner: the change that introduced the dirty `worktreeFormat.ts` edit. Reactivation trigger: a review range that includes that edit or any change to spinner-decoration parsing.

## Specialist question responses

- Data/security found no authority, containment, Save-provenance, or source-reopen defect in the reviewed range.
- Logic found no additional ordering, claim-rollback, prefix-retention, or lifecycle race beyond the adjudicated departure cleanup boundary.
- Contracts confirmed pathless static/runtime validation, exact sidecar reminting, and current-offer Save/Create use; F004 is its surviving cleanup finding.
- Frontend found no form-gate, tick, focus, rendering, or accessibility defect.
- Performance confirmed ordinary records/models are capped, but found F002 at repository departure.
- Reuse confirmed the prerequisite holder/offer/material machinery is reused and found F003's duplicated collision owner.
