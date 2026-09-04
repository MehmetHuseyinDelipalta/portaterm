# Review Round 1

- Date: 2026-09-05
- Cycle: 1
- Mode: discovery
- Scope: commits `6ce87fd0`, `655fe716`, `1206b059`, `1f2f3333`, and `d5276949` only; commit `9f014ff7` and `asimov/changes/add-a-copy-file-for-this-create-only/**` excluded
- Head: `d5276949fa17fd086bd96494bb43e797e7b92ace` (explicit commit scope; checkout was dirty in excluded analytics state)
- Reviewable lines: 317
- Agents spawned: `asm-review-data-security` ×1; `asm-review-logic` ×2; `asm-review-contracts` ×1; `asm-review-performance` ×1; `asm-review-reuse` ×1
- Agents skipped: `asm-review-frontend` — no production frontend or webview behavior changed
- Verdict: BLOCK
- Counts: 2 BLOCK, 0 WARN, 0 SUGGEST
- Verification evidence: `bun run asm change verify-status suggest-missing-initialization-alongside-provider-config` records tasks `1_1` and `2_1` at exit 0. Review did not rerun project verification. Two targeted `bun -e` probes reproduced F001 and F002 without creating files.

## F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-performance`
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:421`
- Title: Exact full-base boundary appends a 198th read row
- Evidence: The guard returns only when `baseRows > MAX_READ_ROWS + 1`. With `MAX_READ_ROWS = 196`, an optional caller may pass a 197-row base and a fresh uncapped budget. The guard admits it, line 424 resets `budget.rows` to 197, and the first candidate reaches `full()`: because `capped` is still false, `full()` appends the cap problem, producing 198 rows. A targeted probe with 197 base entries and an existing `.env` returned `before: 197`, `after: 198`, `capped: true`. The added test covers 196 rows, not this exact boundary.
- Impact: `suggestProvisioning` violates its accepted direct-API contract that a full base plus `newBudget()` cannot exceed the read allowance. The 198-row model leaves room for only two of the three host-reserved rows and can make later host composition exceed `MAX_MODEL_ROWS` or withhold a required host statement.
- SuggestedFix: Treat an uncapped base already at `MAX_READ_ROWS + 1` as full: return unchanged for `baseRows >= MAX_READ_ROWS + 1` (while retaining the earlier `budget.capped` refusal), and add the exact 197-row fresh-budget witness.
- Status: accepted
- Triage: Open gating defect. This is concrete evidence against D3's final-model bound despite the design text using the same strict comparison; the task's direct optional-base acceptance and host reserve require the inclusive boundary.
- Invariant: A read model never exceeds `MAX_READ_ROWS + 1`, and supplementation never consumes any of the host's three reserved rows.
- Boundary inventory: affected — optional base with exactly 197 rows plus a fresh uncapped budget; verified safe — production cap-hit paths retain `budget.capped` and return unchanged, a 196-row base may add only the cap statement to reach 197, bases above 197 return unchanged, and uncapped native-merge refunds below the boundary remain bounded.

## F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; `asm-review-logic`
- Class: feature
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:201`
- Title: Silently skipped malformed tasks are marked complete
- Evidence: The task loop at lines 173–176 silently skips non-object task members, and lines 178–185 silently treat a non-mapping or array `runOptions` as an unmarked task. Neither path records a problem or a separate damaged state. The new final return derives `suggestible` only from `model.problems.length === 0`, so these malformed declarations are marked complete. A targeted probe of `{ "tasks": [42] }` returned an empty model with `suggestible: true`; `readProvisioning` will therefore append environment/setup suggestions over that malformed provider answer.
- Impact: The change violates the accepted fail-closed rule that malformed, invalid-shape, or damaged provider answers receive no suggestions. A malformed task that attempted to describe setup can be silently discarded while a lockfile-derived setup command is offered in its place, masking provider intent and defeating the change's highest-risk completeness boundary.
- SuggestedFix: Track adapter completeness independently of emitted problems, setting it false whenever a task member or relevant `runOptions` shape is invalid, or report those malformed shapes and derive the flag from that state. Add direct-adapter and dispatcher witnesses for a non-object task member and malformed `runOptions` with an existing lockfile/environment candidate.
- Status: accepted
- Triage: Open gating defect. D4 explicitly requires invalid shapes and damaged keys to return false; direct framework reads and source switches both trust this flag.
- Invariant: Suggestions are appended only after the selected provider has explicitly proven a complete answer.
- Boundary inventory: affected — VS Code Tasks array members with non-object shapes and task records with malformed `runOptions`; verified safe — provider open/outer JSONC failures, top-level/non-list task shapes, marked tasks with malformed commands/args, Asimov parse/key problems, Orca parse/known-key problems, native tolerant-parse damage, unresolved inheritance, assembly problems, and all direct/switch dispatch gates once an adapter returns false.
