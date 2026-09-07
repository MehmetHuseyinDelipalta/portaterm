# Review round 2 — decompose-mutation-service

Date: 2026-09-07
Cycle: 2
Mode: discovery
Head: 460463174ac8169222f6e052bdc8d1aa760f777c
Scope: commit 460463174ac8169222f6e052bdc8d1aa760f777c only
Tree: Head equals reviewed commit; unrelated dirty paths are outside this commit and were not reviewed
Reviewable lines: 54 added/modified lines in `src/worktree/mutationService/createRun.ts` (53 comment/rationale lines, 1 unreachable string literal)
Agents spawned: 2; 0 skipped
Verdict: APPROVE
Counts: 0 blocking / 0 warnings / 0 suggestions

## Scope lock

Pass. Commit-only scope excludes parent `d3585994`, which belongs to `decompose-worktree-view`.
The reviewed commit contains one remediation task for this change: restore F001's exact unreachable
throw string and F002's rationale comments. The added round-1 report, task metadata and analytics
telemetry are persistence/metadata, not new capability, contract, design or invariant ownership.

## File classification

| File | Category | Disposition |
|---|---|---|
| `src/worktree/mutationService/createRun.ts` (+54 −11) | reviewable | specialist + chair review |
| `asimov/changes/decompose-mutation-service/.reviews/round-1.md` | review persistence | context only |
| `asimov/changes/decompose-mutation-service/tasks.md` | change metadata | context only |
| `asimov/changes/decompose-mutation-service/analytics.json` | machine telemetry | skipped |

No test or production dependency file changed.

## Verification evidence

The review did not rerun project verify commands. `bun run asm change verify-status decompose-mutation-service`
records task 4_4 exit 0 with scope unchanged. The handoff's final Verify Gate reports: types pass;
Biome 757 files with the same 14 existing warnings; fs-deletion gate 77 scoped modules / 1 carve-out;
unit 325 files / 8066 tests pass.

Targeted chair probes:

1. Transpiled parent and commit versions of `createRun.ts` with TypeScript and `removeComments: true`,
   then diffed the JavaScript. The only executable delta is:
   `unreachable create mode: ${mode.kind}` → `"${mode.kind}" is not a git worktree add; it has no CreateSource.`
2. Compared that literal to `8756b82e:src/worktree/worktreeMutationService.ts:1132`; it is byte-for-byte exact.
3. `git diff --check 46046317^ 46046317 -- src/worktree/mutationService/createRun.ts` exits 0.
4. The five frozen suites have no diff in this commit.
5. Mapped every accepted F002 rationale independently from the base to the remediated module:
   phase 1 base :635 → head :73; adopt :646 → :79; reattach :654 → :87;
   resolved-once :671 → :104; clearance-last :733 → :131; unreadable-debris :743 → :140;
   approved-evidence :761 → :158; phase 2 :695 → :194; changed-path :703 → :202;
   current-emptiness :715 → :210; branch-name :723 → :218; sourceOf history :1110 → :328.
   Each block sits beside the same unchanged guard or operation.

## Full-flow impact trace

The commit does not change any branch or await. `fresh`, `fresh-detached` and `reuse` pass
`prepareCreate`, enter the same coordinator body, and map through `sourceOf` to `newBranch`, `detached`
and `existingBranch`. `adopt` and `reattach` still return through `registerExisting` before the queued
create and before the single `sourceOf` call at `runQueuedCreate`. Therefore the restored throw remains
unreachable from every supported mode. Comment insertion is lexically inert: no directive prologue,
ASI-sensitive boundary, type syntax, catch/fallback arm, persistence/cache state or side-effect order is
changed. The destructive sequence remains phase 1 → coordinator wait → full phase 2 → all refusal
checks → authorization redemption/clearance → `git worktree add` → provisioning/reporting → disposal.

Findings: none

## Round-1 dispositions

### F001
- Status: fixed

The exact base throw literal is restored at `src/worktree/mutationService/createRun.ts:350`.

### F002
- Status: fixed

Every accepted security/escaped-defect rationale block is restored beside its original guard or
operation. The logic specialist independently found no omission or semantic relocation.

### F003
- Status: rejected

Inherited byte-identical helper; not introduced or worsened by the decomposition. No materially new
evidence reopens it.

### F004
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-reuse
- Class: feature
- File: src/worktree/mutationService/createProvisioning.ts:91-105
- Title: `CreateProvisionState` is a ten-field mutable carrier threaded through three phase functions
- Evidence: Round 1 cited design.md D1's statement that carrying the provisioning values across the `:999` cut would require a mutable state carrier. The rebuttal points out that the shipped `CreateProvisionState` is private inside `createProvisioning.ts`, not a carrier across the `createRun.ts` ↔ `createProvisioning.ts` edge D1 discusses.
- Impact: none established. The state record is allocated once per `provisionCreated` call, passed only to three module-private functions, and discarded after `MutationOutcome` construction.
- Reach: none — the current ordering is correct, the record is not exported or returned, and concurrent creates allocate distinct records.
- Adjudicated-by: asm-review-reuse (sonnet[1M]); chair
- Adjudication: D1 lines 46-54 define the disputed `:999` versus `:1048` cut between the two extracted modules; grammatically, “carrying those across” refers to crossing that file boundary. `CreateProvisionState` is declared without export at :91, allocated locally at :404, threaded through explicitly awaited `applyMaterials`, `runSetupAndLaunch` and `settleProvisioning`, and never captured by `createCreateProvisioning` (whose closure retains only `deps`). The public `CreateProvisioning` interface returns only `Promise<MutationOutcome>`. Two concurrent calls cannot share the record. The reuse checklist's split-cohesion defect requires reaching back into the origin's internals; this state is wholly owned by its extracted module and does not. The rebuttal is sustained.
- Witness: none — no behavioral defect or reachable harm exists to witness.
- SuggestedFix: none; the proposed refactor would be preference-only and is not an obligation of this change.
- Status: rejected
- Triage: Rebuttal accepted — D1 forbids a state carrier across the module edge, not private per-call intra-module state.

### F005
- Status: audit-backlog

Owner: Asimov plan templates. Reactivate when the frozen-inventory witness pattern is next edited.
The commit does not touch design.md or the witness, so it remains outside this remediation cone and
non-gating.

## Specialist reports

- `asm-review-logic` — F001/F002 remediation fidelity and five-mode impact trace — gpt-5.6-terra[1M]: clean; exact literal and all twelve rationale groups verified.
- `asm-review-reuse` — F004 rebuttal and state lifetime/ownership — sonnet[1M]: rebuttal sustained; F004 rejected; no in-cone reuse finding.
