# Review round 1 — decompose-mutation-service

Date: 2026-09-07
Cycle: 1
Mode: discovery
Head: 62046a43a31e5c9a97a754a7f7f7c0e7dd7adae7
Scope: range 8756b82e12c76a8de5677942d19aa08f9c8954e7..62046a43a31e5c9a97a754a7f7f7c0e7dd7adae7 (frozen, caller-supplied)
Tree: clean for `src/` at review time; working tree is one commit past Head (d3585994, `src/webview/worktree/**` only, outside this diff's dependency closure)
Reviewable lines: 1183 (createProvisioning 434 + createRun 320 + serviceTypes 388 + root 41 added) — NOTE: large change, accuracy may decrease
Agents spawned: 6 (5 review assignments + 1 reach adjudication); 0 skipped
Verdict: WARN
Counts: 0 blocking / 2 warnings / 3 suggestions

## File classification

| File | Category |
|---|---|
| `src/worktree/mutationService/createProvisioning.ts` (+434) | reviewable |
| `src/worktree/mutationService/createRun.ts` (+320) | reviewable |
| `src/worktree/mutationService/serviceTypes.ts` (+388) | reviewable |
| `src/worktree/worktreeMutationService.ts` (+41 −922) | reviewable |
| `asimov/changes/decompose-mutation-service/analytics.json` | skipped — machine-owned telemetry |
| `asimov/changes/decompose-mutation-service/{tasks,workflow}.md` | skipped — change artifacts |

No test file changed — by design (OBL-3).

## Witnesses reproduced by the chair

All six obligation witnesses were run at the frozen Head, not accepted from the ledger.

| id | claim | result |
|---|---|---|
| OBL-1 | provision material disposed on every exit of a create | pass — `disposeProvisionMaterials` present only in the root's `try/finally` (`worktreeMutationService.ts:245-251`), absent from `createRun.ts`; suite green |
| OBL-2 | one `DebrisAuthorizationStore` for issue/redeem/forget | pass — store resolved once at `createRun.ts:314`; `createCreateRun` has exactly one call site (`worktreeMutationService.ts:107`); `issue` (:282), `redeem` (:127), `forget` (:123) all read the same `runtime`; the root constructs none |
| OBL-3 | inherited regression net byte-identical | pass — `git diff --exit-code 914dbb2b -- <5 suites>` exit 0, `--cached` form exit 0, and `git diff --exit-code 914dbb2b 62046a4 -- <5 suites>` exit 0 |
| OBL-4 | composition root holds no moved state | pass — frozen-inventory grep prints nothing; root is 253 lines against the ~350 the ledger pairs it with. Witness gap recorded as F005 |
| OBL-5 | destructive-fs carve-out list does not grow | pass — `pnpm run gate:fs-deletion`: 77 scoped modules, 1 declared carve-out (`src/worktree/clearDebris.ts`). The gate scopes by the `src/worktree/` prefix, so all three new modules are in scope; the defeater ("a removal moves into a module the gate does not scan") is structurally unavailable |
| OBL-6 | create's destructive ordering unchanged | pass — `runQueuedCreate` reproduces the base coordinator body step for step: context-null → full phase-2 `validateCreatePath` → `check.path !== first.path` → `lstat`+`pathMoved` → `mustBeEmpty` re-readdir → `branchNameIsValid` → migration-authority → debris clearance → migration-authority again → `createWorktree`. Every phase-2 refusal still precedes `clearDebris`. Suite green |

Acceptance suite at the frozen Head, in a clean detached worktree: **218 passed / 218** across all five suites (`worktreeMutationService.test.ts` 180, `mutationService/{removal,registerExisting,setupExecution}.test.ts`, `extension.worktreeMutations.test.ts` 17). Matches the recorded baseline exactly.

Verify Gate (`asm change verify-status`): 4_1 exit 0 scope-changed, 4_2 exit 0 scope-changed, 4_3 exit 0 scope-unchanged. The two `scope-changed` marks are expected in a sequential three-cut decomposition of one file; 4_3's Verify is the full five-suite command and its scope is unchanged, so the final state is the verified one.

## Chair differential

The review's core was a token-level semantic differential of the base create region
(`8756b82e:src/worktree/worktreeMutationService.ts:625-1134`) against the two extracted modules,
with comments and whitespace stripped and receiver renames normalized
(`deps.service.` → `deps.`, `input.request.` → `request.`, `state.` → ``, `input.worktreePath` → `check.path`).
Every base-only token resolved to a structural rewrite whose new form was read and matched:
`let x` → `CreateProvisionState` field, `if (moved)` → `pathMoved(...)`, `const ctx` → `const context`,
`return coordinator` → `await deps.coordinator`, `?executeSetup(` → `?deps.setup.executeSetup(`,
shorthand `{manifestWarning}` → `{manifestWarning: state.manifestWarning}`.
No executable statement, refusal message, outcome field, `because` code, `catch` placement,
concurrency point or await ordering was dropped or reordered — with the single exception recorded as F001.

Export surface is identical: `createWorktreeMutationService` and `existenceFromStatError` as values,
plus the same nine types, now re-exported from `serviceTypes.ts`. `src/extension.ts:115-118` needs no edit.

Full-flow trace (create, per mode): `extension.ts` → `createWorktreeMutationService` → disposal wrapper →
`runCreate` → `prepareCreate` (migration-mode refusal / adopt / reattach / repo-gone / phase-1 refusal, all
still reported synchronously in the calling tick, since no `await` precedes them) → `coordinator.run` →
`runQueuedCreate` (phase 2) → `clearAuthorizedDebris` → `createWorktree` (git) → `provisionCreated`
(migration → exclusions → materials → ports → setup/launch → manifest → retry staging → outcome) →
`.then` reporting arm → `finally` disposal. A rejection out of provisioning still propagates uncaught
through the coordinator `body` into the `.then` error arm and reports a create error, as before.

## Adjudication notes

- **Refuted:** the `asm-review-logic` (opus) assignment reported 4 failing migration cases
  ("`migrationIndeterminate` is undefined") at both base and Head, in worktrees it created itself, and
  concluded the "byte-identical regression suite is green" premise was untrue. The chair reproduced the
  suite at exactly `62046a43` in a clean detached worktree with the repository's own `node_modules`:
  **180/180** for `worktreeMutationService.test.ts` and **218/218** for the full acceptance set. The
  specialist's failures are an artifact of its own worktree environment, not a defect at the frozen Head.
  No finding recorded.

## Findings

### F001
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-logic; chair
- Class: feature
- File: src/worktree/mutationService/createRun.ts:307
- Title: `sourceOf`'s throw message changed during a move the plan declared verbatim
- Evidence: base `8756b82e:src/worktree/worktreeMutationService.ts:1132` threw ``new Error(`"${mode.kind}" is not a git worktree add; it has no CreateSource.`)``; the extracted copy at `createRun.ts:307` throws ``new Error(`unreachable create mode: ${mode.kind}`)``. A literal-by-literal comparison of the base regions `:548-571`, `:625-1065` and `:1087-1134` against the two new modules shows this is the only string delta in the whole extraction — every refusal message, `because` code and outcome literal is otherwise byte-identical.
- Impact: if the arm ever became reachable, the coordinator's error arm would surface `messageOf(error)` to the user with different text, and the message no longer names why the mode has no `CreateSource`.
- Reach: none — `sourceOf` is called only at `createRun.ts:213`, inside `runQueuedCreate`, which runs only after `prepareCreate` has already returned early for `adopt` (`:80-83`) and `reattach` (`:84-87`). `mode.kind` there is confined to `fresh | fresh-detached | reuse`, so the changed arm cannot execute.
- Adjudicated-by: chair
- Adjudication: walked `prepareCreate`'s two delegating early returns and the single `sourceOf` call site; confirmed the throw is unreachable from any shipped entry point, so the text change has no user-visible path.
- Witness: none — the arm is unreachable, so no test can distinguish the two messages without first breaking `prepareCreate`'s guards.
- SuggestedFix: restore the original message text, or record it in design.md D4 as an accepted deviation from the verbatim lift.
- Status: accepted
- Triage: Accepted — restore the exact unreachable throw text from the base.

### F002
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: feature
- File: src/worktree/mutationService/createRun.ts:71-73,78-79,121-125,176-178,183,189,292
- Title: Security and defect rationale deleted from the destructive path during a declared-verbatim move
- Evidence: the base create region carries 93 comment lines (87 distinct after normalization); the two extracted modules carry 67 (61 distinct). The loss is deletion, not relocation. Absent from the extraction: the round-1 B3 rationale at base `:742-747` ("An unreadable directory is not an empty one. Redeeming it as `[]` made it a subset of every approved set, so contents nobody could inspect passed the comparison") — it sat on the `forget(check.path)` + refuse arm now at `createRun.ts:121-125`; the round-2 B4 phase-1 rationale at base `:633-638` ("...cannot detect a change because it never saw the earlier state. This is the 'earlier state'"); the W9 rationale at base `:723-724` (branch-name validity before anything is created), now `createRun.ts:189` bare; base `:702-706` ("The same input string now normalizes somewhere else, which means something in the ancestry was replaced"), now `:176-178` bare; base `:715-716` ("Emptiness is re-asked of the CURRENT observation, not inherited from phase 1"), now `:183` bare; the ~19 lines at base `:646-664` explaining why adopt and reattach leave before the create-path check, condensed to two at `:78-79`; and the `sourceOf` history at base `:1105-1117` recording a real shipped defect (`fatal: invalid reference`), reduced to a one-line doc at `:292`. design.md § D4 permits exactly four non-pure transformations — a `let` becoming an accessor, "a block comment moving with the code it describes", trimming an unused destructure or import, and 4_1's type re-export — and closes "Anything beyond this list is a design change."
- Impact: the module that owns this repository's only irreversible destructive path loses the recorded reason each guard exists. The next reader of `createRun.ts:121-125` has no record that returning `[]` for an unreadable directory was a shipped authorization bypass, and the next reader of `:183` has no record that inheriting `mustBeEmpty` from phase 1 defeats the two-phase check. That is the class of erasure that makes a guard look removable.
- Reach: none — comments do not execute; the extracted control flow retains every corresponding validation, refusal, clearance and source-selection operation.
- Adjudicated-by: asm-review-contracts (gpt-5.6-luna[1M])
- Adjudication: independently recounted comment lines across both regions (93/87 base vs 67/61 extracted) and located each named rationale in the base and its absence at the corresponding extracted line; then checked each affected executable region for a matching code deletion and found none, establishing that the divergence is confined to prose.
- Witness: `diff <(git show 8756b82e:src/worktree/worktreeMutationService.ts | sed -n '625,1134p' | grep -oE '//.*') <(git show 62046a4:src/worktree/mutationService/createRun.ts; git show 62046a4:src/worktree/mutationService/createProvisioning.ts | grep -oE '//.*')` — catches restoring the comments (the base-only set empties) and catches a future move that drops more.
- SuggestedFix: restore the deleted rationale verbatim alongside the code it describes — at minimum the B3, B4, W9, adopt/reattach, normalization, emptiness and `sourceOf` blocks. If the condensation is intended, amend design.md D4 to permit it rather than leaving the shipped code outside the accepted transformation list.
- Status: accepted
- Triage: Accepted — restore the security and defect rationale beside the moved guards, verbatim where applicable.

### F003
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- Class: feature
- File: src/worktree/mutationService/createProvisioning.ts:68-75
- Title: `migrationReasonOf` re-implements the repository's error-message extraction
- Evidence: `migrationReasonOf` performs `error instanceof Error ? error.message : String(error)` itself, while `src/worktree/errorMessage.ts:11-13` already owns that rule as `messageOf` — which `createProvisioning.ts:21` imports and uses elsewhere in the same file. Two owners for one extraction rule can drift.
- Impact: a change to thrown-value formatting can land in `messageOf` while migration failures keep the older semantics.
- Reach: none — the two implementations are behaviourally equivalent today; nothing observable differs.
- Adjudicated-by: chair
- Adjudication: diffed the shipped helper against `8756b82e:src/worktree/worktreeMutationService.ts:159-166` — byte-identical. The duplication predates this change and was relocated verbatim; this diff did not introduce it. Downgraded from the finder's WARN under the rule against flagging unchanged code, and recorded rather than dropped because the relocation makes it newly separable.
- Witness: none — no behavioural difference to catch.
- SuggestedFix: derive the source text through `messageOf(error)` and keep only the migration-specific 1,000-character clamp and fallback local. Non-blocking; it is a candidate for a later cleanup, not for this change.
- Status: rejected
- Triage: Inherited byte-identical helper, not introduced or worsened by this decomposition.

### F004
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-reuse
- Class: feature
- File: src/worktree/mutationService/createProvisioning.ts:91-105
- Title: `CreateProvisionState` is a ten-field mutable carrier threaded through three phase functions
- Evidence: the extraction introduces a mutable `CreateProvisionState` at `:91-105` and mutates it across `applyMaterials` (`:201-279`), `runSetupAndLaunch` (`:281-335`) and `settleProvisioning` (`:337-400`). The pre-split code held the same eleven values as local `let` bindings in one closure (`8756b82e:...:874-1017`). The change's own design.md D1 rejects exactly this shape as its reason for placing the module boundary at `:1048` rather than `:999`: "Carrying those across would need a mutable state carrier, which is a worse module than the one it replaces." The shipped code honours the module boundary and then re-creates the carrier inside it.
- Impact: the four phase functions stay coupled through mutable state rather than a responsibility boundary. A future edit must keep field assignments and reader ordering in step across three functions; a missed or stale assignment silently changes the outcome, the manifest, the setup-retry staging or the launch report, with no type error.
- Reach: none — the current field ordering is correct.
- Adjudicated-by: asm-review-logic (gpt-5.6-terra[1M])
- Adjudication: verified each of the ten fields' initialization point, assignment point and reader against the original closure and found the sequence preserved; confirmed `provisionCreated:421-427` reproduces the original's early exit (skipping materials, setup/launch, manifest, retry staging and outcome assembly), that the concurrent-launch branch preserves catch ownership and await order, and that every path reaching `settleProvisioning` has already awaited `launch()` so `openFailure` is never read before its write. The mechanism is real; the harm is maintainability, not behaviour. Confidence lowered from the finder's HIGH because D1's argument was against a carrier crossing a *module* edge, and this one is intra-module.
- Witness: none — no behavioural defect to catch; the risk is prospective.
- SuggestedFix: make the phase boundaries explicit by returning immutable results (`prepareMigration` → migration outcome, materials → `{provisioned, allocatedPorts, portWarnings, provisionedAt, authorizations}`, setup/launch → `{setupOutcome, openFailure}`) and composing them in `provisionCreated`, or keep the settle-to-outcome pipeline as one function as D1 describes.
- Status: rejected
- Triage: Rebut — D1 rejects carrying mutable state ACROSS the module boundary. This record is private to one module and is the mechanism that lets its phase functions live at module scope; no caller can observe or retain it.

### F005
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: machinery
- File: asimov/changes/decompose-mutation-service/design.md:117-130
- Title: OBL-4's executable witness cannot see an `import` binding, so it under-proves its own claim
- Evidence: OBL-4 claims the composition root "declares none of the identifiers in the frozen inventory below, under that name OR an alias". Its witness anchors on `^\s*(let|const|function|interface|type) <name>`, which matches no `import` form. The shipped root binds five inventory names locally at `worktreeMutationService.ts:56-62` via `import type { MutationOutcome, MutationServiceDeps, MutationVerb, ResolvedTarget, WorktreeMutationService } from "./mutationService/serviceTypes"`, and the grep still prints nothing.
- Impact: the witness would pass unchanged if a moved binding were reintroduced through an import rather than a declaration. It proves less than the obligation states.
- Reach: none — the five bindings here are type-only, erased at runtime, and create no second owner for moved state; the root's remaining runtime bindings are the collaborator wiring D1 deliberately keeps. The paired line-count check corroborates (253 lines against the ~350 the ledger names).
- Adjudicated-by: asm-review-contracts (gpt-5.6-luna[1M])
- Adjudication: ran the ledger's grep verbatim against `62046a43:src/worktree/worktreeMutationService.ts` (printed nothing), then read the root and located the five inventory names bound at `:56-62`, confirming the pattern cannot reach either `import` or `import type`; separately checked the root for a moved implementation or state binding under any name and found none, so the gap is unexercised here.
- Witness: `git show 62046a4:src/worktree/worktreeMutationService.ts | grep -nE '^\s*import (type )?\{' -A8 | grep -E '(debrisAuthorizations|writtenExclusions|openFailure|provisionedAt)'` — catches a moved runtime binding smuggled back through an import, which the ledger's own grep misses.
- SuggestedFix: broaden OBL-4's pattern to cover `import` and `import type`, or state the type-only re-import as an explicit, named exception in the obligation. Keep the line-count check as the secondary guard against duplicated implementation; it does not substitute for binding coverage. Carry this to the next change in the series, which reuses the same ledger form.
- Status: audit-backlog
- Triage: Valid non-gating witness precision debt; owner: Asimov plan templates; reactivate when the frozen-inventory pattern is next edited. The runtime/root-size half and type erasure mean it cannot falsify this change’s shipped obligations.

## Sub-agents spawned

- asm-review-logic: `createRun.ts` — create control flow, destructive ordering, early-exit fidelity — opus[1M]
- asm-review-logic: `createProvisioning.ts` — state carrier, async ordering, outcome assembly — gpt-5.6-terra[1M]
- asm-review-data-security: debris authorization store identity, clearance ordering, evidence binding — sonnet[1M]
- asm-review-contracts: `serviceTypes.ts` move fidelity, export surface, dependency `Pick` narrowing, module cycles — gpt-5.6-terra[1M]
- asm-review-reuse: split cohesion, duplication introduced by the cut — gpt-5.6-luna[1M]
- asm-review-contracts: reach adjudication of the two chair-only findings — gpt-5.6-luna[1M]
