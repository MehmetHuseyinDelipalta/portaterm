# Review round 1 — decompose-worktree-mutation-service

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: commit range `ef96ea01..HEAD`
- Head: `2dcb448673f92805bde8932d07ade0c7af8ff81f` (tree clean for `src/`; an unrelated `.gitignore` edit and an untracked `docs/audit/` file are outside the reviewed range)
- Reviewable lines: 1121 added across 5 production files — NOTE: large change, though the great majority is moved code verified by byte-level diff rather than read afresh
- Agents spawned: 6 specialists + 1 reach adjudicator; 0 skipped
- Verdict: APPROVE
- Findings: 4 open (0 BLOCK, 0 WARN, 4 SUGGEST), 2 rejected at adjudication
- Split: 0 gating blockers — 0 feature / 0 machinery

## What was verified

The claim under test is NO-DELTA: a behaviour-preserving decomposition. The primary evidence is
line-level equivalence of every moved body against `ef96ea01`, established by diff rather than by
reading:

- **create-proper** (facade `:666-1066` vs original `:1340-1748`) — byte-identical after whitespace
  normalisation apart from the single intended substitution of the inline delete/mint/insert block
  by `setup.register(...)` (facade `:1057`). Nothing else in the retained ~400 lines moved.
- **adopt body** (`registerExisting.ts:219-306` vs original `:1138-1225`) — byte-identical.
- **reattach body** (`registerExisting.ts:328-405` vs original `:1255-1332`) — byte-identical.
- **`removeWorktree`** (`removal.ts:158-335` vs original `:880-1057`) — identical modulo the two
  intended renames (`removeWorktree` → `runRemoveWorktree`, closure calls → `deps.*`). Token
  spending, the pre-assessment `observation` capture, the synchronous re-read immediately before the
  git command, `ctx.settle()` placement, the post-settle `resolve`-null forget, and all six clauses
  of the branch-delete consent binding are unchanged.
- **facade additions** — 62 added lines total, all accounted for: 5 imports, 41 lines of factory
  wiring, 2 `forgetAbsent` calls, 4 delegations, 2 branch dispatches, the `register` call. Every
  other change to the file is a deletion, so all retained members (`issueDebrisAuthorization`,
  `lockWorktree`, `unlockWorktree`, `pruneRepo`) are unchanged by construction.
- **helper migration is a move, not a copy** — `recordFor`, `holdsStaleRegistration`, `liveHolderOf`,
  `adoptDeclineReason`, `declineReason`, `residueNote`, `atRisk`, `asOutcome`, `retryKey`,
  `setupRetries`, `fingerprints` all have zero remaining occurrences in the facade.
- **`setup.register`** correctly fuses original `:1729-1741`: unconditional delete, the
  `pendingSetupRetry !== undefined` guard, the resolve-and-`normalizePathForCompare` comparison, and
  minting only on a match. `null` return ⇔ the original's "no `setupRetryId` on the outcome".
- **`reconcileFingerprints`** — original walked fingerprints then setup retries over one `present`
  set; the facade calls `removal.forgetAbsent(present)` then `setup.forgetAbsent(present)` in that
  order, each body a verbatim lift of its half.
- **Import graph** — all four back-edges from the new modules to the facade are `import type` and
  erase at runtime. Only `src/extension.ts` and `src/extension.worktreeMutations.test.ts` consume the
  facade externally, and both take types plus the factory; no consumer referenced a moved helper.
- **OBL-4** — `git diff ef96ea01..HEAD --stat -- src/types/` is empty; `src/test/` is likewise
  untouched, so the I10 gate source is unedited as task 1_4's Boundary requires.
- **Verify gate** — `asm change verify-status` records 1_1..1_4 all exit 0. Per review rules the
  project's suites were not re-run.

### The two deliberate deviations

Both hold.

**`outcomes.ts` instead of lifting `settled` into facade module scope.** The cycle the author names
is real: `removal.ts` and `registerExisting.ts` are imported *by* the facade, so importing a *value*
back from it would be a runtime cycle, not merely a type one. Placing the two pure projections in a
leaf module that imports only types is the correct resolution and does not relocate the cycle. See
F004 for an inaccuracy in how the deviation was justified, which does not affect the conclusion.

**`openFailure` as a local per handler instead of a shared accessor pair.** Verified against
`ef96ea01`. In the original, `let openFailure` at `:1112` was declared before both branches, but
every path out of the adopt block (`:1123-1231`) and the reattach block (`:1241-1338`) is a `return`
— the debris early-return and the `return coordinator.run(...).then(...)` tail. Create-proper is
therefore unreachable once either branch is entered, and neither branch can observe a value written
by create-proper or by the other. The variable was never shared state in fact, only in scope, so a
local per handler is behaviour-identical and an accessor pair would have manufactured a coupling the
code does not have. The deviation is an improvement on the written Plan. The migration guard at
original `:1114` still precedes both debris guards, now at facade `:641` ahead of the two dispatches
at `:650` and `:662`.

## Findings

### F001
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: src/worktree/worktreeMutationService.ts:388
- Title: `RemovalReport`'s doc comment still says `atRisk` is in "the same module"
- Evidence: The comment on the exported `RemovalReport` type reads "Git's force mode is derived later from fresh evidence by the same module's single `atRisk` predicate". At `ef96ea01` that was true — `atRisk` was defined at `:1773` of the same file. It now lives at `src/worktree/mutationService/removal.ts:81`, a different module, while `RemovalReport` stayed on the facade. Adjudication confirmed exactly one repo-wide definition and that the comment's other claims (single predicate, derived from fresh evidence, panel never chooses force) remain accurate.
- Impact: A reader following the comment looks for the predicate in the wrong file. No runtime effect.
- Reach: none — documentation only; the comment annotates a type declaration and no code reads it.
- Adjudicated-by: asm-review-logic (independent adjudicator; chair was the finder)
- Adjudication: Ran a repo-wide search for `atRisk` and found a single definition at `removal.ts:81-91` with a single force-selection use at `:240-258`; confirmed the predicate is applied to fresh redemption evidence and that the report path issues authority without choosing force, so only the "same module" clause is stale.
- Witness: none — a comment cannot be witnessed by a test
- SuggestedFix: Change "the same module's single `atRisk` predicate" to "the removal module's single `atRisk` predicate".
- Status: accepted
- Triage: Accepted. The comment was true at `ef96ea01` and my move made it false; I did not re-read the type's doc when I took `atRisk` out of the file. Fixing as suggested.

### F002
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: src/worktree/mutationService/removal.test.ts:123
- Title: `setPresent(["w1","w2"])` is a no-op, so the recreate scenario its comment names is not modelled
- Evidence: The harness initialises `present` to exactly `new Set(["w1", "w2"])` at `:54`, and nothing between that line and `:123` narrows it — the module's own post-settle `if (deps.resolve(target) === null) fingerprints.forget(...)` does not mutate the harness's set. The call at `:123` therefore restores identical state, while its comment claims "The worktree is back — a recreate at the same location, which is exactly the case a still-live token would destroy without being asked."
- Impact: The test's double-spend assertion at `:126-128` is still sound — the second attempt is refused by `fingerprints.redeem` before git — but it proves one-shot redemption, not the same-location recreate the comment advertises. A reader trusting the comment would believe a scenario is covered that is not.
- Reach: none — a test-fidelity gap; the production path is a verbatim move and unchanged.
- Adjudicated-by: asm-review-logic (independent adjudicator; chair was the finder)
- Adjudication: Traced the harness's `present` state transitions from initialisation at `:54` through the first `removeWorktree` and confirmed the `withTarget` double never removes an entry, so `:123` restores identical state; confirmed the `:124-128` assertions still reach `fingerprints.redeem` and are rejected before git.
- Witness: none — the finding is that the existing witness proves less than its comment claims
- SuggestedFix: Either drop `h.drop("w1")` into the test before `:123` so the set genuinely loses and regains the id, or reword the comment to say what is actually asserted (redemption is one-shot).
- Status: accepted
- Triage: Accepted, and the finding is right about which claim the test actually proves. Taking the reword rather than `h.drop`: dropping and restoring with nothing in between is still a no-op on the harness state, so it would make the code look like it models a recreate without modelling one. The honest assertion here is one-shot redemption, and F003's fix is where the absent-target path gets its own witness.

### F003
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: src/worktree/mutationService/removal.test.ts:66
- Title: The new suite's `withTarget` double never invokes `missing`, leaving the D15 token-spend path unwitnessed here
- Evidence: The double at `:66-72` returns silently when `deps.resolve(t)` yields `null` and never calls the `missing` callback. The production `missing` handler at `removal.ts:325-334` is the D15 path that forgets the confirmation when the worktree is already gone — the one round-3 B5 exists to protect. Adjudication additionally found the pre-existing coverage weaker than assumed: `src/worktree/worktreeMutationService.test.ts:898` ("spends the token when the target is already gone before the body runs") drives the missing-target flow but passes `undefined` rather than the token at `:920-921`, and its later assertion is not isolating because the recreated target has clean evidence, so an absent `--force` is equally explained by ordinary unforced removal.
- Impact: No defect today — `removal.ts:325-334` is a byte-identical move. But the module that now owns the fingerprint store ships a suite that cannot see its most security-relevant exit, and the older suite's assertion on that exit does not discriminate. A future edit to the `missing` handler would go uncaught by both.
- Reach: none — the production code is unchanged from `ef96ea01` and the weak pre-existing assertion is in a file this change was forbidden to edit.
- Adjudicated-by: asm-review-logic (independent adjudicator; chair was the finder)
- Adjudication: Read the harness double at `:66-72` and confirmed it has no `missing` branch; then read `worktreeMutationService.test.ts:898-928` and established that the missing-target call passes `undefined` in place of the token and that the follow-up assertion cannot separate token-spend from an ordinary unforced removal.
- Witness: none yet — the proposed fix would create one
- SuggestedFix: Give the harness double a `missing` branch mirroring `withTarget`'s, then assert that a token issued for `w1` is dead after `removeWorktree` runs against an id the tree no longer resolves. That is the assertion neither suite currently makes.
- Status: accepted
- Triage: Accepted and BUILT rather than deferred. This is a genuine hole in a suite I wrote, on the module that now owns the confirmation store, and the adjudication showing the older suite's assertion cannot discriminate is what settles it — deferring would leave the D15 exit unwitnessed in both places. Small: the double gains a `missing` branch and the module gains one test.

### F004
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair
- Class: feature
- File: src/worktree/mutationService/removal.ts:14
- Title: `settled` is documented as read by removal in three places; it is not read by removal at all
- Evidence: `removal.ts:14` opens "`withTarget` and `settled` are NOT this module's." `design.md` D4 states `settled` "is read by reattach and by removal". `tasks.md` 1_2 Plan step 3 repeats "`settled` (`:710`) is pure and read by removal and by 1_3's reattach". A repo-wide search shows `settled(` is called only at `worktreeMutationService.ts:575,580,616,785` and `registerExisting.ts:367` — `removal.ts` neither imports nor calls it, and did not at `ef96ea01` either, where `removeWorktree` used `asOutcome` instead. `removal.ts` imports only `paths` from `outcomes.ts` (used at `:257`).
- Impact: The stated justification for `outcomes.ts` is partly false. The module is still correctly justified — `paths` is genuinely shared between `removal.ts` and the facade's lock/unlock, and `settled` between `registerExisting.ts` and the facade — so the conclusion survives, but an accepted design artifact carries a claim the code contradicts, and a future reader reconciling D4 against the code will find the boundary argued on a premise that does not hold.
- Impact-note: This is the class of inaccuracy that makes a later reviewer distrust the whole ledger, which is why it is recorded rather than waived.
- Reach: none — no code path reads a comment or a planning document; the boundary the documents justify is itself sound.
- Adjudicated-by: chair (established by direct search, not by a second agent — the item is a documentation-accuracy statement with no candidate mechanism to adjudicate, and was not a BLOCK candidate at any point)
- Adjudication: Searched the tree for `settled(` and for `settled` inside `removal.ts`; the only occurrence in that file is the prose at `:14`. Confirmed against `/tmp/asmrev/orig.ts` that `removeWorktree` used `asOutcome`, never `settled`, before the change, so this was never true rather than newly false.
- Witness: none — a documentation claim
- SuggestedFix: Correct `removal.ts:14` to name only `withTarget`, and amend design.md D4 and tasks.md 1_2 step 3 to attribute `settled` to reattach and the facade, `paths` to removal and the facade. Neither edit changes the decision.
- Status: accepted
- Triage: Accepted. My error, in all three places. `removeWorktree` used `asOutcome`, never `settled`; I asserted the sharing from the plan's wording instead of from the code. The `outcomes.ts` boundary survives on `paths` (removal + facade) and `settled` (registerExisting + facade), but the premise as written was false and is corrected in the comment, design.md D4 and tasks.md 1_2 step 3.

### F005
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-logic; chair
- Class: feature
- File: src/worktree/worktreeMutationService.ts:453
- Title: Optional dependencies moved from call-time reads to construction-time snapshots
- Evidence: The original closure evaluated `deps.runSetup`, `deps.writeProvisionManifest`, `deps.retireSetupOutput`, `deps.reportProvisioning`, `deps.deleteBranch`, `deps.pathDeps` and `deps.runner` on the caller's `deps` object at every invocation. The facade now snapshots them into per-module dependency objects at factory-construction time (`:453-456`, `:466-474`, `:478-484`), so a value installed after construction would no longer be seen.
- Impact: None reachable. Refuted at adjudication.
- Reach: none — adjudication enumerated both construction sites and found neither can mutate the object afterwards.
- Adjudicated-by: asm-review-logic (independent adjudicator)
- Adjudication: Enumerated every construction site. Production builds the dependency object as a single literal inside the `worktreeMutations` memo at `src/extension.ts:812-816`, does not retain it for mutation, and supplies `deleteBranch` inline at `:1085-1091`; `worktreeHost.mutationBindings()` returns a fresh object per call at `src/providers/WorktreeHost.ts:2567` and does not supply `deleteBranch`. The harness at `worktreeMutationService.test.ts:140-214` retains `deps` but never mutates it after construction, and the mock at `extension.worktreeMutations.test.ts:106-117` wraps before the factory call rather than after.
- Witness: none — no defect to witness
- SuggestedFix: None required. Recorded so a future change that installs a capability lazily knows the snapshot exists.
- Status: rejected
- Triage: rejected — refuted at adjudication, no reachable mutation path

### F006
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-logic
- Class: feature
- File: src/worktree/mutationService/removal.ts:154
- Title: `assessRemovalReport`'s coordinator body gained an `async` wrapper
- Evidence: Original `:841` was `body: () => assess(target)`; the moved form at `removal.ts:154` is `body: async () => assess(target)`, which adds promise-adoption microtasks before the coordinator's `await step.body(...)` settles. Under a NO-DELTA spec any semantic delta in a moved body is worth stating, and this path issues a removal-confirmation token.
- Impact: None. Refuted at adjudication.
- Reach: none — the widened window lies entirely inside a held queue entry.
- Adjudicated-by: asm-review-logic (independent adjudicator; a different agent from the finder)
- Adjudication: Read `mutationCoordinator.ts:63-99` and established that the per-repository queue entry is held until `step.body(...)` settles, so no same-repository mutation can enter during the extra microtask; the rebuild barrier is already awaited at `:79-87` before the body, the body never calls `ctx.settle()`, and the coordinator's `finally` settlement still follows body resolution. Fingerprint issue inside `assess` is not coordinator-serialised in either version, so no new interleaving class is created.
- Witness: none — no defect to witness
- SuggestedFix: Optionally restore `body: () => assess(target)` to keep the moved body byte-identical to its original. Cosmetic.
- Status: rejected
- Triage: rejected — refuted at adjudication, no interleaving reachable

## Support review (Phase 2.5)

Three new test files, 20 cases, no `.only` and no `.skip`. Every asynchronous call is awaited; the
six bare calls are to synchronous members (`register`, `forgetAbsent`). Fixtures carry no PII or
secrets — paths are synthetic (`/repo`, `/wt/a`). The witnesses for OBL-1 and OBL-2 assert what they
claim: `setupExecution.test.ts:92-102` spends an authority issued for `r1` against `r2` and asserts
refusal plus an intact key set, which the whole-service suite structurally cannot see because every
retry case there uses one repository; `registerExisting.test.ts:103-107,118-119` assert the
corroboration and listing dependencies were never called rather than asserting the message, which is
the assertion the "guard moved past corroboration" mutation survives. Both files carry genuine
control cases (`:125-140` in registerExisting) proving the guard rather than the harness is what
refused. F002 and F003 record the two places where the removal suite proves less than it says.

## Sub-agents spawned

- asm-review-logic: `removal.ts` + `outcomes.ts` — destructive path, token spending, consent binding — opus[1M]
- asm-review-logic: `registerExisting.ts` — adopt/reattach, the `openFailure` deviation, guard ordering — gpt-5.6-terra[1M]
- asm-review-logic: `setupExecution.ts` — the rotating one-shot retry authority, `register`, `forgetAbsent` — sonnet[1M]
- asm-review-contracts: facade seam — deps interfaces, coordinator adapters, import cycle, type surface — gpt-5.6-terra[1M]
- asm-review-reuse: split cohesion — move-vs-copy, `outcomes.ts` as a boundary, duplicated scaffolding — gpt-5.6-luna[1M]
- asm-review-data-security: authorization surface — both token stores, path guards, I10 gate scope — gpt-5.6-luna[1M]
- asm-review-logic: reach adjudication of the four chair-only candidates — gpt-5.6-luna[1M]
