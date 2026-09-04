# Review Round 3

- Date: 2026-09-05
- Cycle: 2
- Mode: discovery
- Arbiter: yes
- Scope: full change through `d168ad94`, excluding commit `9f014ff7` and `asimov/changes/add-a-copy-file-for-this-create-only/**`; new discovery against the corrected Gate-2 specification
- Head: `d168ad94b73ef1b9798ed6e082cebdf01eed5ba7` (explicit commit scope; checkout was dirty outside this review target)
- Reviewable lines: 448
- Agents spawned: `asm-review-contracts` ×1; `asm-review-data-security` ×1; `asm-review-logic` ×1; `asm-review-performance` ×1; `asm-review-frontend` ×1; `asm-review-reuse` ×1
- Agents skipped: none
- Verdict: BLOCK
- Status: blocked
- Counts: 1 BLOCK, 0 WARN, 1 SUGGEST; prior F001 and F002 remain fixed
- Verification evidence: `bun run asm change validate suggest-missing-initialization-alongside-provider-config` returned 0 errors and one non-blocking task-sizing warning. `bun run asm change verify-status suggest-missing-initialization-alongside-provider-config` records tasks `1_1`, `2_1`, and `3_1` at exit 0. Review did not rerun project verification. A targeted no-file `bun -e` probe confirmed that a complete Asimov provider plus `package.json` workspaces still appends `apps/web/.env` unchecked while keeping the provider active.

## F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-performance`
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:421`
- Title: Exact full-base boundary appends a 198th read row
- Evidence: The inclusive `baseRows >= MAX_READ_ROWS + 1` guard and exact 197-row regression remain present and unchanged through `d168ad94`.
- Impact: Closed; supplementation preserves the host reserve at the exact boundary.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: Round-2 disposition remains valid; the corrected specification introduces no evidence that reopens the runtime defect.
- Invariant: A read model never exceeds `MAX_READ_ROWS + 1`, and supplementation never consumes any of the host's three reserved rows.
- Boundary inventory: verified safe — exact 197-row fresh-budget base, capped production paths, 196-row cap-statement path, bases above 197, and uncapped native-merge refunds.

## F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-logic`
- Class: feature
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:173`
- Title: Silently skipped malformed tasks are marked complete
- Evidence: The independent `complete` bit still forces non-object task members, non-mapping `runOptions`, and non-text `runOptions.runOn` to `suggestible: false`, including when problem reporting reaches the row cap.
- Impact: Closed; malformed task material cannot receive supplemental environment or setup suggestions.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: Round-2 disposition remains valid. The new problem rows are truthful reports for malformed shapes that prevent the adapter from determining provisioning intent; they do not violate the canonical rule for valid keys used for unrelated purposes.
- Invariant: Suggestions are appended only after the selected provider has explicitly proven a complete answer.
- Boundary inventory: verified safe — malformed nested task shapes, valid empty/unmarked/non-create tasks, direct adapter reads, ordinary framework dispatch, preferred-provider switching, and native inherited dispatch.

## F003

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-contracts`
- Class: feature
- File: `asimov/changes/suggest-missing-initialization-alongside-provider-config/specs/worktree-panel/spec.md:25`
- Title: Corrected delta still leaves the canonical empty-source outcome contradictory
- Evidence: The corrected delta requires a complete empty source plus `.env` to keep the source active and append `.env` unchecked. But the untouched canonical requirement `A present source answers, even when its answer is nothing` at `asimov/specs/worktree-panel/spec.md:1789-1800` still requires a present source declaring nothing to supply the offer “as an empty section”; its scenario likewise says “the section is empty.” Applying the current delta therefore leaves two canonical requirements assigning mutually exclusive visible outcomes to the same complete-empty-source state. Current code and `readProvisioning.test.ts:124` implement the new non-empty suggestion outcome.
- Impact: Archive would publish a self-contradictory behavioral source of truth. A future plan following the older canonical clause can legitimately re-suppress suggestions over an empty complete provider, reversing this change while claiming spec conformance.
- SuggestedFix: Add a MODIFIED delta for `A present source answers, even when its answer is nothing`. Preserve first-hit detection and suppression of later providers, but state that an empty complete source contributes no configured rows of its own while eligible host suggestions may append; update its scenario to distinguish those suggestions from the later provider's rows.
- Status: accepted
- Triage: Arbiter sustained the blocker. The contradiction directly falsifies the accepted complete-empty-source scenario and must be resolved before archive; it is not audit backlog or a wording preference.
- Invariant: One canonical state has one observable section outcome; source selection and host supplementation are described without contradictory row counts.
- Boundary inventory: affected — complete empty first-order source with an eligible root or workspace suggestion; verified safe in code — provider remains active, later providers contribute no configured rows, and host suggestions append from the same bounded detector; unaffected — no-source fallback and incomplete-provider suppression.

## F004

- ID: F004
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; `asm-review-contracts`
- Class: feature
- File: `asimov/changes/suggest-missing-initialization-alongside-provider-config/specs/worktree-panel/spec.md:55`
- Title: Incomplete-provider wording understates the implemented fail-closed rule
- Evidence: The added requirement names unreadable, malformed, and unresolved-inheritance answers, while approved D4 and the implementation suppress suggestions for any provider problem. For example, a readable, well-formed native answer with an `unknownKey` problem is `suggestible: false` through `nativeProvider.ts:142` and `readProvisioning.ts:396-399`, but that non-fatal problem class is not named by the canonical delta.
- Impact: Current code is safely stricter, but a later implementation following only the archived requirement could loosen completeness and append suggestions around problem-bearing answers without visibly changing the named scenarios.
- SuggestedFix: Define incomplete as an answer carrying any provider problem, then retain the three current causes as examples or scenarios; add a non-fatal problem-row scenario if the distinction is load-bearing.
- Status: accepted
- Triage: Valid contract-hardening suggestion, non-gating because current implementation and approved D4 already enforce the stronger fail-closed behavior.

## Arbiter dispositions

- F003 — accepted: the current delta would archive mutually exclusive canonical outcomes for a complete empty source; unblock when the delta also reconciles `A present source answers, even when its answer is nothing` without weakening first-hit provider precedence.
