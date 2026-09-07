# Review round 1 — decompose-worktree-view

- Date: 2026-09-07
- Cycle: 1
- Mode: discovery
- Head: 8756b82e12c76a8de5677942d19aa08f9c8954e7 (tree clean for `src/`; frozen range `1f21b202..8756b82e`)
- Reviewable lines: ~4958 added / ~2903 removed across 22 reviewable files (NOTE: large change — accuracy may decrease)
- Agents spawned: 6 (asm-review-logic ×3, asm-review-frontend, asm-review-contracts, asm-review-reuse) · skipped: asm-review-data-security, asm-review-performance (no persistence, no endpoint, no growth axis, no hot-path recompute introduced — pure in-process module move)
- Verdict: WARN
- Counts: blocking 0 · warnings 1 · suggestions 6

## Scope and evidence

Reviewed the frozen range `1f21b202976e45ebc9abe3795d61821609475331..8756b82e12c76a8de5677942d19aa08f9c8954e7`.
The head sha named in the dispatch (`5464b985…`) does not exist in this repository; the coordinator's
correction named `8756b82e`, which is the current HEAD, and that is what was reviewed. No later commit exists.

Skipped per Phase 0 classification: `asimov/changes/**` artifacts, `docs/**`.
Test files: the seven regression suites are byte-identical to `914dbb2b` by design (OBL-4) — nothing to
review inline; `dialogChannels.test.ts` moved path only.

Witnesses reproduced by the chair (not the author's record):

- OBL-4 — `git diff --exit-code 914dbb2b -- <7 suites> && git diff --cached --exit-code 914dbb2b -- <7 suites>` → exit 0, exit 0. The regression net is untouched.
- OBL-5 — both frozen-inventory greps (controller fields, view fields) → exit 1, no output. Neither facade holds a moved field.
- Boundary (proposal Scope + tasks 3_13/3_14/3_15) — `wc -l`: `WorktreeController.ts` 416, `WorktreeView.ts` 485, `worktreeView/actionNotices.ts` 444; every extracted file under 500 (max `treeRender.ts` 473).
- OBL-1 read through rather than run: `WorktreeView.rowMemo` is one `Map` created as a field (`WorktreeView.ts:115`) and passed BY REFERENCE into both `treeRender` and `worktreeRow` (`WorktreeView.ts:130` → `composeViewCollaborators.ts:134,159`). `dispose()` clears that same object; the empty-listing path clears it through `renderListing`'s `finally` sweep against a `rowMemoSeen` reset at the top of every pass. No second memo exists — the stated defeater does not hold.
- OBL-2, OBL-3 — witnesses are full vitest suite runs; per the chair rules the suite was not re-run. Cited from the recorded Verify Gate: `asm change verify-status decompose-worktree-view` reports all 15 tasks `[x] exit 0`, each on the seven-suite command.

Registry audit: `docs/DESIGN.md` has no `§ Cross-Cutting Invariants` section — no registry rows to audit.

Intent reconstruction: the diff matches the accepted plan. Files not named in design.md D1's table
(`controller/createAnswers.ts`, `controller/menuActions.ts`, `controller/composeCollaborators.ts`,
`controller/composeViewDeps.ts`, `controller/composeCreateDialogDeps.ts`,
`worktreeView/worktreeRow.ts`, `worktreeView/composeViewCollaborators.ts`) are each authorized by a
Gate-2-approved task Plan (3_13, 3_14 step 2, 3_15 steps 2-3) or by a recorded workflow.md deviation.
No design delta; no new invariant owner; admission `in-contract` holds.

## Full-flow trace (discovery, mandatory)

1. **Visibility → subscription → tree → render.** `setVisible` → `visibility.applySubscription` (level derivation, `wasSubscribed` short-circuit, one-at-a-time launch-target ask, refresh abandon on hide) is statement-identical to base `:805-878`. → `treeReconcile.handleTreeResponse` reconciles against the OUTGOING tree before storing (verified: `state.tree` is assigned after `reconcile`), → `push` → `view.setData` → `tree.applyAt(ceilingClock.now())`.
2. **Create, all three doors.** row/header/toolbar → `createFlow.openCreateForRepo` (every door asks every repository; caches cleared; `refsToken += 1`) → nine host answers in `createAnswers.ts`, each dropping on the live opening → `openPendingCreate` → `view.openCreateDialog` → `dialogs.openCreateDialog` captures `createOpening()` once → submit posts `worktreeCreate` with `createFlow.refsToken()` BEFORE `retire()` posts `worktreeCreateClosed` and advances the token. Order preserved.
3. **Launch / resume / attribution.** `handleLaunchTargets` → `syncLaunchActions` mutates the live `menuActions` record in place (still one object; `deps.menuActions()` reads it at call time) → `push` → the render signature's `actions?.launchAgentHere` term repaints the row control.
4. **Mutation result → notice → placement.** `handleMutationResult` → `toActionResult` → `showActionResult` → `rescope` (result door, `present` omitted) → `setActionResults` → `push` → `treeRender.render` → `placeResults`. The tree door (`rescopeNotices`) always passes `present`, so the `tree === null` guard and the create canonical-id arm are unreachable there — identical to base.
5. **Teardown.** `WorktreeController.dispose` → `view.dispose` → `disposed = true`, `rowMemo.clear()`, `ceilingClock.dispose()` (clearTimeout), `notices.dispose()`, `dialogs.dispose()` (closeDialog + null), `menu?.close()`, `disposeTooltips()`. Same steps in the same order as base, minus `rowMemoSeen.clear()` — see F003.

Evaluation-order check on the one non-mechanical rewrite: base did `this.probeSeq += 1;` then posted
`worktreeCreateProbe`; the new code inlines `seq: seam.createFlow.nextProbeSeq()`. `token` precedes
`seq` in the object literal, so the token is still read before the increment and the counter still
advances exactly once per settled edit.

## Findings

### F001
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-contracts; chair
- Class: feature
- File: src/webview/worktree/controller/composeCreateDialogDeps.ts:51
- Title: `ViewDepsSeam.view()` is declared and wired but never read, and its type denies the `undefined` it returns
- Evidence: `ViewDepsSeam` declares `view(): WorktreeView` at `composeCreateDialogDeps.ts:51`, and `WorktreeController.ts:181` supplies `view: () => this.view` inside the `buildViewDeps({...})` argument — evaluated before `this.view` is assigned on the next statement. `grep -n "seam\.view"` over `composeViewDeps.ts` and `composeCreateDialogDeps.ts` returns nothing: neither builder reads it. The base's inline `new WorktreeView({...})` literal (`/tmp/dwvbase/WorktreeController.base.ts:466-795`) never read `this.view` either, so nothing was lost — the member is new dead surface added by the extraction.
- Impact: The seam advertises a capability it does not consume, and types a non-optional `WorktreeView` for an accessor that returns `undefined` at compose time. A later compose-time read — the natural thing to reach for, since the type says it is safe — gets `undefined` with no compiler signal, turning the construction-order cycle into a runtime failure instead of a typed contract violation.
- Reach: none — no consumer exists today, so no user action reaches it.
- Adjudicated-by: chair
- Adjudication: Ran `grep -n "seam\.view\|view()" src/webview/worktree/controller/composeViewDeps.ts src/webview/worktree/controller/composeCreateDialogDeps.ts` — the only hit is the declaration itself. Walked the base constructor literal (`sed -n '447,1010p'` of the base file, filtered for `this.view`) and confirmed the first `this.view` read is `this.element.append(this.view.element)` AFTER the literal, so no reader was dropped. With no consumer there is no path from shipped behaviour to a defect.
- Witness: none — no reach, so no BLOCK and no witness is owed.
- SuggestedFix: Delete `view(): WorktreeView` from `ViewDepsSeam` and the `view: () => this.view` entry at `WorktreeController.ts:181`. If a consumer is added later, declare it as `view(): WorktreeView | undefined` or move it to a call-time-only accessor so the type states the initialization timing honestly.
- Status: accepted
- Triage: Accepted — dead pre-initialization accessor; delete the declaration and wiring.

### F002
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-reuse
- Class: feature
- File: src/webview/worktree/controller/composeViewDeps.ts:14
- Title: One dep object is defined across two files, and the shared seam type is owned by the lower half
- Evidence: `buildViewDeps` (`composeViewDeps.ts:36`) builds the `WorktreeViewDeps` object but delegates the `createDialogDeps` half to `buildCreateDialogDeps`, imported at `composeViewDeps.ts:14`. The shared `ViewDepsSeam` interface — the contract BOTH builders consume — is declared in `composeCreateDialogDeps.ts:38` and re-exported upward by `composeViewDeps.ts:16`, so the more specific module owns the more general type. The file header states the split's reason as the 500-line Boundary.
- Impact: A change to the view dependency contract now touches two modules that jointly define one object and one lifecycle, and the seam type's home is the opposite of its dependency direction — a reader looking for the contract finds it in the file that consumes a slice of it.
- Reach: none — file organisation only.
- Adjudicated-by: chair
- Adjudication: Read task 3_14's Plan step 2 in `tasks.md`: the split itself is explicitly authorized by the Gate-2-approved plan ("and — when the two halves exceed the Boundary — `composeCreateDialogDeps.ts` for the `createDialogDeps()` half"), so the cut is not re-litigable. The actionable residue is the type-ownership inversion, which the plan does not name. Downgraded from the finder's WARN to SUGGEST on that basis: no defect, no reach, and the split is an accepted decision.
- Witness: none — no reach.
- SuggestedFix: Move `ViewDepsSeam` into `controller/controllerTypes.ts` (or a `controller/viewDepsSeam.ts`) so both builders import it from a peer, and drop the upward re-export at `composeViewDeps.ts:16`.
- Status: audit-backlog
- Triage: Valid non-gating organization debt; owner: worktree webview; reactivate when either view-deps builder changes. It cannot falsify OBL-1..5 because it moves only a type declaration.

### F003
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; asm-review-frontend
- Class: feature
- File: src/webview/worktree/WorktreeView.ts:339
- Title: `dispose()` no longer clears `rowMemoSeen`, and two file headers assert it is still a `WorktreeView` field
- Evidence: The base `dispose()` (`/tmp/dwvbase/WorktreeView.base.ts:718-731`) called both `this.rowMemo.clear()` and `this.rowMemoSeen.clear()`. The new `dispose()` (`WorktreeView.ts:339-347`) calls only `this.rowMemo.clear()`. `rowMemoSeen` is now a `const` Set created inside the collaborator factory (`composeViewCollaborators.ts:72`) and shared by reference with `treeRender` and `worktreeRow`; `grep -rn rowMemoSeen src/` shows no `WorktreeView` field. Yet `treeRender.ts:10` and `worktreeRow.ts:13` both carry the header "`rowMemo` and `rowMemoSeen` stay FIELDS on `WorktreeView` and arrive by reference; a suite reads both (D5, OBL-1)" — false for `rowMemoSeen`, and D5's pin table never listed it.
- Impact: No observable defect. `rowMemoSeen` holds only worktree-id strings (no DOM nodes, no closures over the tree), is unconditionally cleared at the top of every `renderListingInner` (`treeRender.ts:246`) before it is read, and every render entry point is disposal-guarded (`setData` on `this.disposed`, `repaint` on `deps.disposed()`, `armCeiling` on `deps.disposed()` plus `ceilingClock.dispose()` clearing the handle), so nothing can read it stale. The cost is the two headers, which misdescribe the architecture and invite a future maintainer to satisfy OBL-1 by inspecting an instance field that does not exist.
- Reach: none — the retained value is a string set with no DOM reachability, and no post-dispose reader exists.
- Adjudicated-by: chair
- Adjudication: Enumerated all seven `rowMemoSeen` sites with `grep -rn`; confirmed the only writes are `add` (worktreeRow.ts:122) and `clear` (treeRender.ts:246), and the only read is the sweep at treeRender.ts:229. Traced each render entry point to its disposal guard, confirming no path reaches the sweep after `dispose()`. Independently corroborated by the frontend specialist, which reached the same no-reach conclusion from its own walk.
- Witness: none — no reach.
- SuggestedFix: Correct the two headers to say `rowMemoSeen` lives in the collaborator closure; or, for symmetry with `rowMemo`, surface it on `ViewCollaborators` so `WorktreeView.dispose()` can clear it and the headers become true again.
- Status: accepted
- Triage: Accepted — correct the two stale headers; no runtime change is needed.

### F004
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair
- Class: feature
- File: src/webview/worktree/WorktreeController.ts:281
- Title: `createRepos`'s doc comment is duplicated verbatim by the cut
- Evidence: `WorktreeController.ts:281-282` carries `/** Every repo the host has answered for, as the form's seed. */` twice, back to back, above `private createRepos()`. The diff shows both lines added (`/tmp/dwv-controller.diff:1276-1277` are `+` lines); the base had the comment once, at `/tmp/dwvbase/WorktreeController.base.ts:1008`. The same sentence is also the doc for `CreateFlow.createRepos` at `controller/createFlow.ts:157`, which is where the implementation now lives.
- Impact: Cosmetic residue of the 3_5 cut, in the same family as the orphaned doc-comment head the author already removed in 3_15. Not a linter concern — a duplicated doc block is content, not formatting.
- Reach: none.
- Adjudicated-by: chair
- Adjudication: Located both lines as additions in the region diff and confirmed the single occurrence in the base file; the duplication is introduced by this change, not inherited.
- Witness: none — no reach.
- SuggestedFix: Delete one of the two lines at `WorktreeController.ts:281-282`.
- Status: accepted
- Triage: Accepted — delete the duplicate comment.

### F005
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: src/webview/worktree/controller/treeReconcile.ts:231
- Title: The three pinned answer caches are declared twice, and one declaration erases their value types
- Evidence: `TreeReconcileDeps` declares `createDefaults(): Map<string, unknown>`, `provisionOffers(): Map<string, unknown>` and `repoRefs(): Map<string, unknown>` (`treeReconcile.ts:231-233`), while `CreateFlowDeps` declares the same three accessors with their concrete message types (`createAnswers.ts:76-78`). Both are wired from the same three controller fields in `composeCollaborators.ts:88-90` and `:106-108`.
- Impact: Two declarations of one contract, one of them lossy. `treeReconcile` only calls `.keys()` and `.delete()` so nothing unsound passes today, but a future read of a value through the `treeReconcile` seam gets `unknown` and will be cast rather than checked — and the two declarations can drift without any compiler complaint.
- Reach: none — the widened accessors are used only for key iteration and deletion.
- Adjudicated-by: chair
- Adjudication: Read every use of the three accessors in `treeReconcile.ts` (`sweepDepartedRepos`, lines 96-118): all are `.keys()` / `.delete(repoId)`, none reads a value. Confirmed `composeCollaborators.ts` supplies the identical concrete maps to both seams, so no runtime divergence is possible today.
- Witness: none — no reach.
- SuggestedFix: Give `TreeReconcileDeps` the same concrete value types as `CreateFlowDeps`, or extract one shared `CreateAnswerCaches` interface in `controllerTypes.ts` that both seams embed.
- Status: audit-backlog
- Triage: Valid non-gating type precision debt; owner: worktree webview; reactivate when any answer-cache value is read through TreeReconcileDeps. Current key/delete-only use cannot falsify an accepted obligation.

### F006
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-reuse
- Class: feature
- File: src/webview/worktree/worktreeView/treeRender.ts:391
- Title: The `onCreateForRepo` forwarding expression is repeated at both render sites in the new module
- Evidence: `treeRender.ts:391` and `treeRender.ts:452` both read `deps.view.onCreateForRepo ? () => deps.view.onCreateForRepo?.(repo.repoId) : undefined`. The two sites were carried over from `/tmp/dwvbase/WorktreeView.base.ts:1214` and `:1273`, so the duplication is inherited rather than introduced — but it now sits twice inside one 473-line module whose whole subject is the render pass.
- Impact: The repository header's create affordance and the unbranched empty state's create affordance are enabled by two independently maintained expressions and can diverge.
- Reach: none — both expressions are currently identical, so no behaviour differs.
- Adjudicated-by: chair
- Adjudication: Confirmed against the base that both sites pre-date this change (grep for `onCreateForRepo` across base and head shows the same two call shapes at both revisions), so this is moved code, not new duplication. Kept as a SUGGEST because the move put both copies in one module where a single local helper is now the obvious owner.
- Witness: none — no reach.
- SuggestedFix: Add a local `const createForRepo = (repoId: string) => deps.view.onCreateForRepo ? () => deps.view.onCreateForRepo?.(repoId) : undefined;` in `treeRender.ts` and call it at both sites.
- Status: rejected
- Triage: Inherited duplication, behaviour-identical and outside this structural change; no remediation value for the accepted goal.

### F007
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-contracts
- Class: feature
- File: src/webview/worktree/controller/composeCollaborators.ts:46
- Title: `CollaboratorSeam.options` embeds the whole facade contract where five fields are read
- Evidence: `CollaboratorSeam` declares `options: WorktreeControllerDeps` (`composeCollaborators.ts:46`), which carries `host`, `store`, `init`, `onSelectWorktree`, `onAttribution`, `presenceNeeded`, `showPreview`, `activatePane`, `onCreateAvailability` and `now`. Extracting the actual reads inside `createCollaborators` yields exactly five: `deps.postMessage`, `deps.init.workspaceRoot`, `deps.onAttribution?.`, `deps.onCreateAvailability?.` and `deps.presenceNeeded?.`. Every other member of the seam is a narrow accessor, so this one field is the exception to the file's own stated rule.
- Impact: The seam is documented as "what the collaborators need from the facade", and its remaining members are enumerable accessors; embedding the full dep contract means future wiring can silently acquire `host`, `store`, `showPreview` or `activatePane` without any change to the declared dependency list — the seam stops being the auditable object-graph boundary D5 relies on.
- Reach: none — nothing outside the five fields is read today.
- Adjudicated-by: chair
- Adjudication: Extracted every `deps.*` read in `composeCollaborators.ts` with grep and confirmed the five-field set; confirmed the remaining seam members are all accessors or the pinned maps. No current consumer touches the extra surface, so there is no path from shipped behaviour to a defect.
- Witness: none — no reach.
- SuggestedFix: Replace `options: WorktreeControllerDeps` with the five consumed members (or `Pick<WorktreeControllerDeps, "postMessage" | "init" | "onAttribution" | "onCreateAvailability" | "presenceNeeded">`).
- Status: audit-backlog
- Triage: Valid non-gating seam-width debt; owner: worktree webview; reactivate when composeCollaborators acquires another options read. Current five reads cannot falsify an accepted obligation.

### F008
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair
- Class: feature
- File: src/webview/worktree/WorktreeView.ts:47
- Title: `IDLE_FOLD_THRESHOLD` is re-exported "so no importer moves", but no importer exists
- Evidence: `WorktreeView.ts:45-47` re-exports `IDLE_FOLD_THRESHOLD` from `worktreeView/treeRender.ts` with the comment "Re-exported here so no importer moves." `grep -rn IDLE_FOLD_THRESHOLD src/` finds only the definition (`treeRender.ts:32`), its own use (`treeRender.ts:420`), the direct import in `composeViewCollaborators.ts:25`, and this re-export. No module or suite imports it from `WorktreeView`.
- Impact: A compatibility shim with nothing to be compatible with, and a comment that states a constraint the codebase does not have. Contrast `worktreeMenuActions` and `resolveInitialView`, whose re-exports task 3_15's Boundary shows are genuinely load-bearing for `main.ts` and three suites.
- Reach: none.
- Adjudicated-by: chair
- Adjudication: Ran the repo-wide grep above; every hit is accounted for and none is an importer of the re-export. Verified by contrast that `MAX_WORKTREES_PER_REPO` (kept as a real export on the same file) does have external importers, so the pattern is not uniformly dead.
- Witness: none — no reach.
- SuggestedFix: Drop the re-export and its comment at `WorktreeView.ts:45-47`.
- Status: accepted
- Triage: Accepted — remove the dead compatibility re-export and inaccurate comment.

## Specialist reports summary

- asm-review-logic (opus[1M]) — controller collaborators: no logic issues. Walked the base class member by member; confirmed guard-for-guard equivalence for all nine create-answer handlers, `reconcile` and its five sweeps, `rescope` at both doors, `applySubscription`, `emitAttribution`, `syncLaunchActions`, `toActionResult`. Confirmed no construction-order hazard: no factory invokes a dep during construction, and the first closure to fire is the constructor's trailing `push()` after `this.view` is assigned. Confirmed `pendingCreate` is one record mutated in place by both outside writers.
- asm-review-logic (gpt-5.6-terra[1M]) — view collaborators / lifecycle: no logic issues.
- asm-review-logic (gpt-5.6-luna[1M]) — `actionNotices` split (OBL-2): no logic issues.
- asm-review-frontend (sonnet[1M]) — render, memo, focus, a11y, listeners: one SUGGEST (F003). Confirmed `worktreeMemoKey` is field-for-field identical to base, the `render` ordering and `restoreFocus` fallback chain are verbatim, the memo sweep moved intact, and `openPruneDialog`'s untracked `closeDialog` is inherited from the base rather than introduced.
- asm-review-contracts (gpt-5.6-terra[1M]) — seams and moved types: two findings (F001, F007).
- asm-review-reuse (gpt-5.6-luna[1M]) — cohesion and duplication: two findings (F002, F006).

## Verdict

WARN — one non-gating warning and six suggestions, none with adjudicated reach. Zero gating blockers.
Split over gating blockers: 0 feature / 0 machinery.

The decomposition is behaviour-preserving on every flow traced. Every finding is contract hygiene or
residue of the cut; none changes what the panel does.
