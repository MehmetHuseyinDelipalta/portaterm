# Workflow State: prove-entry-reconstruction-on-windows

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the harness and the recipe already exist, only the platform answer is missing
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [-] Review done — docs, evidence and two doc comments; the delta is `docs/design/worktree-create.md`, `evidence/windows-run.txt`, this file, and two comments in `src/providers/WorktreeHost.ts` with no executable line changed (confirmed by a second opinion). No escalation flags
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-012.14`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.14
Lane: light
Planned at: 4e81e3a4
Lane: light — S, a spike; no product code
- PARKED on 1_2, which needs a Windows machine this session does not have. `scripts/verify-windows-worktree-entry.mjs` was already committed; nothing about it had to change.
- 1_1 captured the darwin control into evidence/darwin-control.txt: verdict RECIPE WORKS on git 2.50.1, all ten checks pass, and the four files the recipe writes are byte-identical to the ones git writes itself AND unchanged by `git worktree repair`. That last part is the load-bearing half — it means the recipe is not merely accepted but produces exactly git's own normal form on this platform, so any Windows difference is a real platform difference rather than a sloppy fixture.
- The spike is NOT satisfied by the control. Its acceptance names Windows, and the interesting output is the diff between platforms.
- Task 1_2 is BLOCKED ON HARDWARE, not on a decision. Its Verify is `manual` and its Boundary forbids modifying the harness to make a platform pass, so it cannot be ticked from darwin — the protocol's "never tick an unrun Verify" applies and the Verify Gate stays unticked. Everything else is ready: `scripts/verify-windows-worktree-entry.mjs` is written and the macOS control is captured in `evidence/darwin-control.txt`.
- Two unblock paths, neither takeable from here. (a) Run `node scripts/verify-windows-worktree-entry.mjs` in a clone on any Windows box with git and node, and paste its RESULT block. (b) A Windows CI runner would satisfy the same Verify, but this repository has no `.github/workflows` at all — standing up its first CI system for one spike is a larger, separate decision than this change owns, so it is recorded as an option rather than taken.
- Note the acceptance's escape clause does NOT apply while the recipe is unrun: "if adoption cannot be made to work there the mode is refused on that platform" requires the recipe to have been executed and FAILED. "Not executed" is not "failed", and refusing adoption on Windows off the back of an untested guess would be exactly the half-working outcome the task exists to prevent.
- Unblock path (b) is SMALLER than this file previously recorded, and orca is why. `orca/.github/workflows/daemon-relocation-spike.yml` is a single-purpose Windows spike runner: `runs-on: windows-2022`, triggered on push to ONE feature branch plus `workflow_dispatch`, `permissions: contents: read`, `persist-credentials: false`, scoped by `paths:` to the spike's own directory, and it runs one script and reports. It is not a CI system — it is one file that does exactly what 1_2 needs, and orca keeps three more of them (`win-crash-survival-e2e.yml`, `windows-terminal-restart-e2e.yml`) for precisely this "prove it on Windows once" shape. So the earlier note's reasoning — that (b) means standing up this repository's first CI system — overstated it; what it actually means is one branch-scoped workflow invoking the already-committed `scripts/verify-windows-worktree-entry.mjs`.
- Still NOT taken here, and the reason is no longer scope. Landing it runs code on GitHub under the repository's Actions budget and needs the branch pushed, which is outward-facing and the user's call, not a blocker the goal delegates. Recommend it at the next gate rather than doing it unasked.

- 1_3 LANDED unblock path (b) as far as it goes locally: `.github/workflows/verify-windows-worktree-entry.yml` is committed, branch-scoped, and invokes the already-committed harness on `windows-2022`. Writing the file is a local change; only `git push` reaches outside. So 1_2's remaining cost is one push by the user, not a Windows machine and not a decision about adopting CI.
- 1_1's tick predated its CLI evidence (`verify-status` reported "done without a verify record"). Unticked by hand and re-closed through `verify-task`, which re-ran the harness on darwin: verdict unchanged, evidence now recorded.

- 1_2 ANSWERED, and the answer is a failure: `verdict: RECIPE FAILS (3 of 11)` on `windows-2022`, git 2.55.0.windows.5, node v22.23.2 (run 33848956772, `workflow_dispatch` on 9ef8c750). Verbatim RESULT block in `evidence/windows-run.txt`; verdict and diagnosed cause recorded in `docs/design/worktree-create.md` § 2.4 beside the darwin control, which re-ran green here at git 2.50.1 — 11 of 11, the earlier note's "ten checks" undercounted the harness's own rows by one.
- DEVIATION from 1_2 Plan step 2: its refusal branch — "if the recipe does not work there, states that adoption is refused on Windows" — is written for a platform limitation, and this is not one. The three failures share one cause visible in the file dump: git writes `<wt>/.git` and `worktrees/<id>/gitdir` with FORWARD slashes on Windows too, the recipe wrote `path.sep`, and `git worktree repair` then dies `error: not a directory` and normalises nothing (the post-repair dump is byte-identical to what the recipe wrote). So § 2.4 records the verdict, the cause, and the fix — spell every recorded path with `/` on every platform — and gates adoption on Windows until that lands and the harness re-runs green. Refused for a named defect rather than for an untested guess; recording "adoption cannot work on Windows" would have been false.
- The recipe fix is NOT made here: 1_2's Boundary is "the harness is not modified to make a platform pass. If it fails on Windows, the failure is the finding." The separator fix belongs to whichever change implements adoption, and § 2.4 now carries the requirement it has to meet.
- Knowledge candidate: git writes worktree administrative paths (`<wt>/.git`, `worktrees/<id>/gitdir`) with forward slashes on Windows, and `git worktree repair` will not normalise a backslash form — it fails `not a directory` and leaves the file untouched | Surprise: `repair` is documented as the thing that fixes stale administrative paths, so it read as the safety net for a separator mistake; it is not, and the entry then neither lists nor survives a prune | Evidence: asimov/changes/prove-entry-reconstruction-on-windows/evidence/windows-run.txt | Consumer: plan | Action: any change writing git worktree administrative files spells recorded paths with `/` on every platform and does not rely on `repair` to normalise
- Verify Gate: type check exit 0; `pnpm run test:unit` 295 files / 7715 tests pass (VITEST_MAX_THREADS=6); `pnpm exec biome check src` exits 1 on ONE pre-existing error, `src/webview/worktree/worktreeFormat.ts:30:27 lint/complexity/noUselessEscapeInRegex`, plus 14 long-standing `noDescendingSpecificity` warnings. Not reproduced against a detached tree because it did not need to be: `git diff --name-only HEAD` lists no `src/` file and there is no untracked one, so `biome check src` read bytes identical to HEAD's. The error is outside this change's files and outside its lease.
- 1_4 added AFTER the first Verify Gate tick, so `All tasks done` and `Gate: implementation approved` were unticked and re-earned rather than left standing over a task that did not exist when they were ticked. Verify Gate re-observed at 1_4: type check 0, 295 files / 7715 tests pass, `biome check` clean on the one file it touched and otherwise unchanged.
- 1_4 hit the rule-of-three lock, and TWO of the three strikes were mine, not the code's: I passed `--test-change` when no leased test file had moved (1_2's record had already advanced the stamp), and a truncated log tail hid the flag error behind what I reported as a suite failure. Strike three was a genuine but unrelated failure — `ClaudeHookInstaller.test.ts:526` asserts a 2000 ms wall-clock bound around a `curl --max-time 1.5` subprocess and came in at 2012 ms under the parallel suite. Second opinion (asm-oracle, HIGH) confirmed the 1_4 delta is two comments with no executable line changed and cannot reach that test; unlocked with `--ack` and re-verified green.
- Knowledge candidate: `verify-task --ack` does not tick and does not re-run — it only clears the lock and resets the attempt counter, and it is refused alongside `--cmd`/`--manual`/`--runner`/`--test-change`, so the unlock and the re-verification are two separate invocations | Surprise: the lock message reads "re-run with --ack", which sounds like one combined call, and `--ack` also names an unrelated `asm debug escalate` flag | Evidence: .agents/skills/asimov/scripts/ops/change/build-task.ts#verifyAckLocked | Consumer: debug | Action: on a strike-3 lock, get the second opinion, run `verify-task <change> <task> --ack` bare, then `task-start` and a normal `verify-task --cmd` to actually tick
- Follow-up, NOT taken here: `src/agentHooks/install/ClaudeHookInstaller.test.ts:526` bounds total wall clock at 2000 ms for a 1.5 s `curl --max-time`, leaving 500 ms for spawn, teardown and event-loop delay — brittle under the 295-file parallel run and worth its own test-hardening change (oracle agreed). Outside this spike's lease and scope.
