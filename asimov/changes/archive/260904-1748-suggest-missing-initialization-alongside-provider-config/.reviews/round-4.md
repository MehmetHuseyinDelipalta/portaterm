# Review Round 4

- Date: 2026-09-05
- Cycle: 2
- Mode: verification
- Scope: spec-only fix in commit `49a9a09d`, adjudicated against round 3
- Head: `49a9a09de5c1add0bdfdd9af4a35294b36b84210` (explicit commit scope; checkout was dirty outside this review target)
- Reviewable lines: 152
- Agents spawned: `asm-review-contracts` ×1
- Agents skipped: `asm-review-data-security`, `asm-review-logic`, `asm-review-performance`, `asm-review-frontend`, `asm-review-reuse` — the remediation cone is limited to F003/F004 canonical contract text and task references
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST; F003 and F004 fixed; prior F001 and F002 remain fixed
- Verification evidence: `bun run asm change validate suggest-missing-initialization-alongside-provider-config` returned 0 errors and the same non-blocking task-sizing warning. `bun run asm change verify-status suggest-missing-initialization-alongside-provider-config` still records tasks `1_1`, `2_1`, and `3_1` at exit 0. No production or test file changed in this round, and review did not rerun project verification.

## F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-performance`
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:421`
- Title: Exact full-base boundary appends a 198th read row
- Evidence: Commit `49a9a09d` changes no production code; the inclusive exact-boundary guard and its regression witness remain unchanged.
- Impact: Closed; supplementation still preserves the host reserve.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: Round-2 and round-3 dispositions remain valid; the contract remediation does not intersect this runtime boundary.
- Invariant: A read model never exceeds `MAX_READ_ROWS + 1`, and supplementation never consumes any of the host's three reserved rows.
- Boundary inventory: verified safe from prior rounds — exact 197-row base, capped and 196-row paths, larger bases, and native-merge refunds.

## F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-logic`
- Class: feature
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:173`
- Title: Silently skipped malformed tasks are marked complete
- Evidence: Commit `49a9a09d` changes no production code; the independent task-adapter completeness bit and dispatcher gates remain unchanged.
- Impact: Closed; malformed task material remains ineligible for supplementation.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: Round-2 and round-3 dispositions remain valid; the revised any-provider-problem contract now documents the implemented fail-closed behavior.
- Invariant: Suggestions are appended only after the selected provider has explicitly proven a complete answer.
- Boundary inventory: verified safe from prior rounds — malformed nested task shapes, valid non-create states, direct/framework/preferred/native-inherited dispatch.

## F003

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-contracts`
- Class: feature
- File: `asimov/changes/suggest-missing-initialization-alongside-provider-config/specs/worktree-panel/spec.md:41`
- Title: Corrected delta still leaves the canonical empty-source outcome contradictory
- Evidence: The delta now MODIFIES the canonical `A present source answers, even when its answer is nothing`. It replaces the contradictory “empty section” outcome with two explicit layers: a complete empty source remains active and contributes zero configured rows of its own, while eligible host initialization suggestions may append unchecked. The scenario preserves the later provider as switchable and forbids any of its rows until switched. The separate bounded-initialization requirement continues to own when eligible suggestions SHALL append, so this requirement's MAY grants compatibility without weakening that obligation.
- Impact: Closed. Applying the delta now yields one coherent outcome for a complete empty source and retains first-hit provider precedence.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: The round-3 witness closes at the canonical requirement that caused it. The contracts specialist independently found no remaining contradiction in the remediation cone.
- Invariant: One canonical state has one observable section outcome; source contribution and host supplementation remain distinct.
- Boundary inventory: verified safe — complete empty first-order source stays active, contributes no configured rows, may receive required eligible host suggestions, exposes later providers only as switches, and problem-bearing sources remain active without suggestions.

## F004

- ID: F004
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; `asm-review-contracts`
- Class: feature
- File: `asimov/changes/suggest-missing-initialization-alongside-provider-config/specs/worktree-panel/spec.md:70`
- Title: Incomplete-provider wording understates the implemented fail-closed rule
- Evidence: The requirement now defines any provider answer carrying any provider problem as incomplete, then names unreadable, malformed, unknown/damaged-key, and unresolved-source examples. The added non-fatal unknown-key scenario requires the problem to remain and suppresses every initialization suggestion. This matches adapter `model.problems` completeness gates and native assembly propagation; valid keys used by a provider for unrelated purposes remain governed by the separate canonical rule and do not become problems merely because they are unrelated.
- Impact: Closed. The canonical requirement now documents the same fail-closed set the implementation enforces.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: The round-3 wording gap is resolved without broadening which valid provider-specific keys are reported as malformed.
