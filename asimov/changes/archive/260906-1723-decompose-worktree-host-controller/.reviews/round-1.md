# Review round 1 — decompose-worktree-host-controller

- Date: 2026-09-07
- Cycle: 1
- Mode: discovery
- Scope: commit range `a3d2416e..HEAD` (10 commits, `42116bd3` … `188bb5ae`)
- Head: `188bb5ae8d815250dad622366841a7b21baf4aaf` (tree clean under `src/`; `analytics.json` dirty from `round-start`)
- Reviewable lines: 3592 added across 11 reviewable files; 372 added across 4 test files
- Agents spawned: 6 (logic ×2, contracts, data-security, frontend, reuse) + chair self-review + 1 reach adjudication
- Agents skipped: performance — no persistence, list endpoint, derived value, cron/drain loop or hot path is touched; every map, sweep and growth axis is the same object with the same bound as at `a3d2416e`
- Verdict: WARN
- Counts: 0 blocking / 2 warnings / 3 suggestions

## Notes

- `reviewableLines` > 800 — large change; accuracy may decrease. Mitigated by mechanical
  normalize-and-diff of every moved cluster against `a3d2416e` rather than eyeballing.
- Registry audit: `docs/DESIGN.md` has no `§ Cross-Cutting Invariants` section, so no row applies.
- OBL-2 re-verified by the chair: `git diff --exit-code a3d2416e..HEAD -- src/types/messages.ts` is empty.
- The move is faithful. Chair evidence, independent of the specialists:
  - **Action table**: the original `handleAction` had 29 `case` labels, no `default`, no fall-through,
    and the prologue `const actions = options.actions; if (!actions || disposed) return;`. The new
    `handleAction` (`WorktreeHost.ts:1730-1824`) has the identical 29 labels in the identical order,
    the byte-identical prologue, and one dispatch per label. `diff` of the two sorted label sets is empty.
  - **Arm bodies**: normalized diff (indentation stripped, `disposed()`→`disposed`,
    `bumpMigrationSequence()`→`++migrationSequence`, `hasSurface(surface)`→`surfaces.has(surface)`,
    `lifecycle.isLive(k,t)`↔`liveOpening.get(k) === t`) of `shell.ts`, `removal.ts`, `provision.ts`,
    `create.ts` and `messageGuards.ts` against their `a3d2416e` regions yields ONLY scaffolding
    (imports, `Deps` interfaces, `case "X": {` → `const X: Arm<"X"> = …`, the `return {…}` block) plus
    four pure reflows and one comment rewording. No guard reordered, none hoisted across an `await`,
    no `onlyKeys` allow-list changed, no `&&`/`||` nesting altered.
  - **Nothing added, nothing deleted**: every line in the new `WorktreeHost.ts` absent from the original
    file is wiring or dispatch — no new logic. Every line in the original absent from the union of the
    new files is a guard declaration that gained `export`, a reflow, the two retired map declarations,
    or an import member that moved to the module that now uses it (`claimProvisionMaterials`,
    `disposeProvisionMaterials`, `prepareResolvedRoot` → `create.ts`; `divergenceOf` → `provision.ts`;
    `isResolvedPathInside` stays in the host — all five confirmed present).
- **Opening reducer (`openingLifecycle.ts`) is equivalent to the two maps.** Original admission was
  `repeat = liveOpening.get(key) === msg.opening; if (!repeat && msg.opening <= (openingHighWater.get(key) ?? 0)) return; if (!repeat) retireOpening(key); liveOpening.set(…); openingHighWater.set(…)`.
  `admitOpen` + `markOpen` reproduce it case by case: repeat → `admitted`, `!supersedes`, `markOpen`
  rewrites the same `live{token}`; stale/delayed → `!admitted` → return; advance (including the FIRST
  ever open, which the original also retired) → `supersedes` → `retireOpening` → `markOpen`. The sweep
  still happens strictly between admission and commit because `admitOpen` is pure. `retireOpening`
  (`WorktreeHost.ts:797`) now opens with `lifecycle.close(key)` and then runs the byte-identical sweep
  unconditionally, exactly as `liveOpening.delete(key)` + sweep did; `close` on pristine/retired is a
  no-op, as `delete` on an absent key was. `forgetSurfaceOpenings` = `retireOpening` + `lifecycle.detach`,
  matching `retireOpening` + `openingHighWater.delete`. Detach drops the high water; close does not.
- **OBL-4 (reference, not copy) holds** at all four factory call sites (`WorktreeHost.ts:1650-1728`):
  every map, the offer store and the cache cross as bare identifiers — no `new Map(x)`, no spread, no
  `structuredClone`, no rebuilding getter. `disposed: () => disposed` and
  `bumpMigrationSequence: () => ++migrationSequence` are accessors per D4.
- **The `disposed` trap did not recur.** Every `disposed` reference in the new modules is `disposed()`;
  the only non-invoked occurrences are a doc comment and the destructuring binding. Verified by
  `grep -rn disposed src/providers/worktreeHost/ | grep -v 'disposed()'`. `shell.ts` and `removal.ts`
  correctly take no `disposed` at all — their original arms never read it, only the dispatcher prologue did.
- **`ShellDeps` deviates from task 2_1's Plan** (which named `surfaces`, `cache`, `options`,
  `disposed: () => boolean`) and declares none of them. The deviation is in the safe direction and is
  documented at `shell.ts:8-10`: the moved bodies provably read none of the four. Recorded, not a finding.
- **New tests are non-vacuous.** `dialogChannels.test.ts` advances the opening before firing and states
  the expected token (`1`, `2`) independently of the code under test, so a live→captured flattening
  fails it; the fourth case pins the other half of the asymmetry. `provision.test.ts` writes
  `provisionBaseline` AFTER `createProvisionActions` has run, which is the only construction that can
  tell a reference from a copy. `openingLifecycle.test.ts` drives all five transitions and asserts one
  predicate — `state.phase !== "live" || highWaterOf(state) === state.token` — that rules out all three
  invalid combinations at once. No `.only`, no `.skip`, no expected value computed by the subject.
- The comment at `openingLifecycle.ts:74` cites `.reviews/round-1.md B1`, which is a prior change's
  round file, not this one. Carried over verbatim from the original declaration comment at
  `WorktreeHost.ts:950` — not introduced here.

## Findings

### F001
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: machinery
- File: src/test/invariants/fsDeletionGate.ts:47
- Title: The I10 gate's scan set shrank by ~2500 lines of formerly watched extension-host code
- Evidence: At `a3d2416e`, `isRemovalPath` matched `src/providers/WorktreeHost.ts` — all 5225 lines of it. This change moved ~2500 of those lines into `src/providers/worktreeHost/{messageGuards.ts,hostTypes.ts,openingLifecycle.ts}` and `actions/{create.ts,provision.ts,shell.ts}`, and re-added only `actions/removal.ts` to the stated list. Among the newly unwatched code is `answerDebrisAuthorization` (`actions/create.ts:604-650`) and `corroborate` (`:653`), which mint and corroborate the `DebrisAuthorization` that later authorises a real deletion. The adjudicator walked that flow: `WorktreeHost.ts:1767` (in scope) -> `actions/create.ts:604-650` (now OUT of scope) -> `issueDebrisAuthorization` -> `src/extension.ts:1391` (out — pre-existing) -> `src/worktree/worktreeMutationService.ts:845-865` (in) -> `src/worktree/clearDebris.ts:49` (in), which calls `node:fs` `rm`. design.md D3 justified the exact-path choice as a prefix pulling create/provisioning/shell in "for no reason"; the debris-authorization mint is a reason, and a prefix costs nothing today because none of those files references `node:fs` at all.
- Impact: A prospective coverage reduction in a regression tripwire, not a present failure. Destructive `node:fs` code added to `actions/create.ts` in a future change passes `gate:fs-deletion`, where the identical code in the identical function would have failed it at `a3d2416e`. OBL-1 exists to prevent exactly this class and closed only the arm the design anticipated.
- Reach: none — no newly unscoped module contains a destructive `node:fs` reference today (independently grepped for rm/rmSync/rmdir/rmdirSync/unlink/unlinkSync/rimraf across all six files: no result), and the executor on both the removal arm and the debris path stays inside the gate's `src/worktree/` prefix, so the gate's current verdict is unchanged.
- Adjudicated-by: asm-review-data-security
- Adjudication: Walked both chains file by file and recorded scope membership at each hop. Removal arm: `WorktreeHost.ts:1748-1759` (in) -> `actions/removal.ts:79-140` (in) -> `src/extension.ts:1603-1619` (out, recorded pre-existing) -> `worktreeMutationService.ts:880,978` (in) -> `worktreeMutations.ts:143-164` (in), which runs `git worktree remove` with no direct fs deletion. Debris path as quoted in Evidence, terminating at the one production fs deletion in the area, `clearDebris.ts:49`, which is inside the list. Concluded the executor remains scoped and the reduction is prospective, and independently rejected "for no reason" as a general rationale for the deletion-authority path.
- Witness: `pnpm run gate:fs-deletion` after planting `import { rmSync } from "node:fs"; rmSync("/tmp/x");` in `src/providers/worktreeHost/actions/create.ts` — catches the descoping: the gate PASSES today and would have FAILED on the same plant in `WorktreeHost.ts` at `a3d2416e`.
- SuggestedFix: Add `actions/create.ts` to the stated list beside `actions/removal.ts`, or state in `fsDeletionGate.ts`'s header why the debris-authorization mint is deliberately outside it. Either records the decision where the next reader of the gate will find it.
- Status: accepted
- Triage: Accepted. The gate is a tripwire; a tripwire whose scan set shrank by 2500 lines is weaker even where Reach is nil today. `actions/create.ts` mints the DebrisAuthorization the deletion path spends, so it belongs in the stated list on the same reasoning that put `actions/removal.ts` there. Fixing in round 1.

### F002
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-reuse; chair
- Class: feature
- File: src/providers/worktreeHost/actions/create.ts:1202
- Title: The provisioning state machine is now split across create.ts and provision.ts
- Evidence: `provisionBaseline` is WRITTEN only in `actions/create.ts:1202-1203` (inside `requestWorktreeCreateDefaults`, seeding the baseline from the active provider) and READ only in `actions/provision.ts:581` (inside the save arm, where it decides `tookSource`). `provisionReading` is owned entirely by `create.ts:1166-1243`; the offer store and `issueWithAdded` are written by both (`create.ts:1214`; `provision.ts:281,337,485,549`). At `a3d2416e` all of this lived in one closure. A future change to baseline semantics, offer invalidation or per-opening retirement must now edit two modules that share no type beyond the maps themselves. The change's own new test records the seam and already states it wrongly: `actions/provision.test.ts:4-5` says `provisionBaseline` "is written by a handler that is STILL in `WorktreeHost.ts` (the create-defaults case)" — that handler is in `actions/create.ts` as of task 2_4, so the comment names the wrong file.
- Impact: Maintainability. The initial-read path and the interactive switch/save paths can drift in their staleness and ownership rules without either module looking wrong from inside. No behavioural difference today — both sides hold the same map references.
- Reach: none — behaviour is identical; the split is structural.
- Adjudicated-by: chair
- Adjudication: Grepped both modules for the shared slots and confirmed the write/read asymmetry above by line: `provisionBaseline.set` appears exactly once in the diff, at `create.ts:1203`; `provisionBaseline.get` exactly once, at `provision.ts:581`. Confirmed against design.md D1's cluster table that Gate 2 approved this split — `requestWorktreeCreateDefaults` is assigned to cluster 6 (create) and the four provisioning arms to cluster 5 — so the cut is the accepted plan, not a deviation. Reported anyway per the review contract: an approved decision is context, not an exemption. It is also independent corroboration of the recorded need for the follow-up split of `create.ts` along the read/commit seam.
- Witness: none — a cohesion property with no behavioural mutation to catch.
- SuggestedFix: In the follow-up `create.ts` split already recorded in workflow.md, move the provisioning seed (`provisionReading` + the `provisionBaseline` write + the first `issueWithAdded`) into `provision.ts` behind a `seedProvisioning(...)` entry the create arm calls, so one module owns the slot's whole life. Also correct the stale file reference in `actions/provision.test.ts:4-5`.
- Status: audit-backlog
- Triage: Valid and non-gating: behaviour is identical (both sides hold the same map references), OBL-4 was independently confirmed to hold, and no accepted obligation or required verification is falsified. The fix — a `seedProvisioning(...)` entry `provision.ts` owns — is a new interface, which is design, not remediation of this change. Owner: the follow-up change that splits `create.ts` along the read/commit seam, already named in workflow.md Notes. Reactivation trigger: that change reaching Stage 3, where the seed becomes part of its D1 rather than a patch on this one.

### F003
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-contracts
- Class: feature
- File: src/providers/worktreeHost/actions/create.ts:89
- Title: CreateDeps takes the whole surfaces map where its siblings take a hasSurface predicate
- Evidence: `CreateDeps.surfaces: Map<WorktreeSurface, unknown>` hands `create.ts` full read/write/iterate access to the host's live surfaces map, but all eleven call sites (`create.ts:249, 293, 433, 450, 636, 1120, 1176, 1208, 1318, 1384`) only ever call `surfaces.has(surface)`. `RemovalDeps` and `ProvisionDeps` take the identical capability as `hasSurface(surface): boolean` (`WorktreeHost.ts:1673, 1691`).
- Impact: The widest of the four Deps contracts overstates what the module needs, and the boundary is inconsistent with the pattern the other two factories establish. No behavioural difference — same object, same read pattern.
- Reach: none — no observable behaviour depends on the declared width.
- Adjudicated-by: chair
- Adjudication: Enumerated every `surfaces` occurrence in `create.ts` independently; all eleven are `.has(...)`, plus the interface line and the destructure. Confirmed `removal.ts:19` and `provision.ts` declare the narrower predicate for the same capability.
- Witness: none — a type-width property with no behavioural mutation to catch.
- SuggestedFix: Replace `CreateDeps.surfaces` with `hasSurface(surface: WorktreeSurface): boolean` and wire it as `hasSurface: (surface) => surfaces.has(surface)`, matching the two sibling factories.
- Status: accepted
- Triage: Accepted. `CreateDeps` should take `hasSurface(surface): boolean` like its two siblings; all eleven call sites already use only `.has`. Fixing in round 1.

### F004
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: machinery
- File: src/webview/worktree/WorktreeController.test.ts:2346
- Title: One existing assertion changed matcher, while the recorded justification says none did
- Evidence: The `--test-change` justification recorded for task 1_2 says the seven retargets left "assertions byte-identical". One did not: `expect(bound, "no applier was bound, so a drop is not what this measures").toBeDefined()` became `expect(channels(h).refs.bound(), <same message>).toBe(true)`. proposal.md's must-not is "Must not change any assertion in any existing test", and design.md D3 anticipated preserving this guard via `Channel.bound()` but also claimed byte-identity.
- Impact: Record accuracy only, on a change whose entire preservation proof is "the suites are unchanged". The substance runs the other way: at base the field was `private applyRefs: (...) | null = null`, and `expect(null).toBeDefined()` PASSES under vitest, so the original precondition could not fail. The replacement reads `sink !== null` and genuinely can. The guard was strengthened, not weakened.
- Reach: none — test-only, and the adjudicator confirmed the surrounding test still catches the production mutation it names.
- Adjudicated-by: asm-review-data-security
- Adjudication: Established vitest `toBeDefined()` semantics as `actual !== undefined` and ran the Node witness `null !== undefined` → `true`, proving the original assertion was vacuous on the field's initial value. Traced the replacement to `dialogChannels.ts:59-67` (`bound: () => sink !== null`) and the bind site at `WorktreeController.ts:598`. Then confirmed the test's primary witness is untouched: it asserts no branch-list DOM node (`:2361`) and no `repoRefs` entry (`:2366`) after delivering a retired token, and `WorktreeController.ts:1298-1307` drops on the token before either mutation — so weakening that guard still fails the test.
- Witness: none — the finding is that a record overstates; there is no behavioural mutation to catch.
- SuggestedFix: Amend the recorded task-1_2 justification to say seven mock targets were retargeted and one vacuous precondition was strengthened from `toBeDefined()` to `bound()`, with the reason. No code change.
- Status: accepted
- Triage: Accepted as a record correction. The reviewer is right twice: the matcher did change, and the original `expect(null).toBeDefined()` was vacuous, so the retarget strengthened the precondition rather than preserving it. Amending design.md D3 — no code change.

### F005
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair
- Class: feature
- File: src/providers/worktreeHost/actions/provision.test.ts:4
- Title: The OBL-4 test's header names the wrong module for the baseline writer
- Evidence: `provision.test.ts:4-5` reads "`provisionBaseline` is written by a handler that is STILL in `WorktreeHost.ts` (the create-defaults case)". That handler moved to `actions/create.ts:1202-1203` in task 2_4, after this test was written in 2_3. The test's mechanism is unaffected — it writes the map directly after the factory has run — but the sentence that explains WHY the test is not vacuous now points at a file that no longer contains the writer.
- Impact: A reader checking whether the OBL-4 test still proves what it claims is sent to the wrong file. Documentation only.
- Reach: none — comment text.
- Adjudicated-by: chair
- Adjudication: Confirmed by grep that `provisionBaseline.set` occurs exactly once in the repository, at `create.ts:1203`, and does not occur in `WorktreeHost.ts`.
- Witness: none.
- SuggestedFix: Update the sentence to name `src/providers/worktreeHost/actions/create.ts` — which strengthens the point, since the writer is now in a different module from the reader.
- Status: accepted
- Triage: Accepted. Task 2_4 moved the baseline writer to `actions/create.ts` after the header was written. Correcting the sentence; the mechanism the test pins is unaffected.
