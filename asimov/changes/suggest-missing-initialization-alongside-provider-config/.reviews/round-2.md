# Review Round 2

- Date: 2026-09-05
- Cycle: 1
- Mode: verification
- Scope: fixes in commits `ce872727` and verification record `d1b033be` only, adjudicated against round 1
- Head: `d1b033bea184867d625f365ab1fadc8ffbfbce6f` (explicit commit scope; checkout was dirty only outside this verification target)
- Reviewable lines: 115
- Agents spawned: `asm-review-performance` ×1; `asm-review-logic` ×1
- Agents skipped: `asm-review-data-security`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-reuse` — the remediation cone touches only the accepted capacity and completeness findings
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST; 2 prior BLOCK findings fixed
- Verification evidence: `bun run asm change verify-status suggest-missing-initialization-alongside-provider-config` records remediation task `3_1` at exit 0 with focused witnesses in `suggestProvisioning.test.ts`, `vscodeTasksProvider.test.ts`, and `readProvisioning.test.ts`. Review did not rerun project verification. Targeted `bun -e` probes reproduced both former witnesses against the remediation and confirmed they now close without creating files.

## F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-performance`
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:421`
- Title: Exact full-base boundary appends a 198th read row
- Evidence: The guard now uses `baseRows >= MAX_READ_ROWS + 1`, so an exact 197-row base returns before budget synchronization, candidate probes, or `full()`. A targeted repeat of the round-1 witness returned the same base at 197 rows with `budget.rows === 0`, `budget.capped === false`, and no cap problem. The regression at `suggestProvisioning.test.ts:745` supplies exactly 197 rows plus an available `.env` and asserts reference identity and an untouched fresh budget.
- Impact: Closed. Supplementation can no longer consume the host reserve from the exact full-base direct-API case.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: The round-1 witness closes at its entry boundary. The specialist independently confirmed no defect in the capacity impact cone.
- Invariant: A read model never exceeds `MAX_READ_ROWS + 1`, and supplementation never consumes any of the host's three reserved rows.
- Boundary inventory: verified safe — exact 197-row fresh-budget base returns unchanged; `budget.capped` still returns unchanged; a 196-row base can emit only the cap statement to reach 197; bases above 197 return unchanged; uncapped native-merge refunds below the boundary still synchronize to final surviving rows and use the shared add gates.

## F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-logic`
- Class: feature
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:173`
- Title: Silently skipped malformed tasks are marked complete
- Evidence: The adapter now keeps an independent `complete` bit and clears it before reporting non-object task members, non-mapping `runOptions`, or non-text `runOptions.runOn`. The final answer requires both `complete` and zero model problems, so a capped `report()` cannot accidentally restore suggestibility. Targeted repeats returned `suggestible:false`, a malformed problem, and no setup for all three malformed shapes; a valid non-create string `runOn` remained suggestible. Direct-adapter tests cover malformed members and `runOptions`, and dispatcher tests assert no `.env` or `pnpm install` supplementation.
- Impact: Closed. Malformed nested task material can no longer be discarded while lockfile/environment suggestions fill around it.
- SuggestedFix: No further fix required.
- Status: fixed
- Triage: The round-1 malformed-member and malformed-`runOptions` witnesses close, including the capped-report path because completeness is tracked independently. The specialist found no bypass in direct adapter, ordinary framework dispatch, preferred-provider switching, or native inherited dispatch.
- Invariant: Suggestions are appended only after the selected provider has explicitly proven a complete answer.
- Boundary inventory: verified safe — non-object members, non-mapping `runOptions`, and non-text `runOptions.runOn` force incomplete; valid empty files, absent `tasks`, valid unmarked tasks, and valid non-create string `runOn` remain suggestible; outer parse/top-level/list errors and marked-task field errors remain incomplete; `readProvisioning` framework and preferred-provider paths consume the corrected adapter boolean, while native assembly still requires inherited completeness.
