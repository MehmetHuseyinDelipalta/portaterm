# Review Round 3: richer-agent-status

**Date**: 2026-09-06
**Cycle**: 1
**Mode**: verification
**Scope**: range `1c8a579a..36cbbc8c`
**Head**: `36cbbc8ca768a5f750b51f16b2d17891ad8c924f` (explicit remediation range; no later or dirty feature code)
**Reviewable lines**: 184
**Agents spawned**: `asm-review-logic`, `asm-review-contracts`
**Agents skipped**: `asm-review-data-security` (no data, auth, input, or removal boundary changed), `asm-review-frontend` (wire activity and presentation inputs are unchanged; only host lifecycle metadata extraction moved), `asm-review-performance` (constant-size metadata extraction in an existing per-pane path), `asm-review-reuse` (no helper, split, or duplicated capability added)
**Verdict**: **APPROVE**
**Counts**: 0 BLOCK, 0 WARN, 0 SUGGEST

## Scope and scope lock

The diff contains the accepted F002 remediation in `projectPanes -> readActivity -> stamp`, adjacent regression tests, prior review artifacts, and task/verification metadata. It adds no capability, contract, design decision, or invariant owner. No production change exists after Head `36cbbc8c`, so the verification scope lock passes.

## Prior findings

### F001

- Status: fixed

### F002

- Status: fixed

## Verification review

The fix computes lifecycle metadata only after confirming the report is fresh and before applying the shell-title activity override. Shell-title still returns inferred `idle`/`title`, but an ordinary non-boundary `done` carries `completionAt` into `stamp`, while a session boundary carries `sessionBoundary` and clears retained completion. Prompt, delegation, and hook activity fields remain excluded from the shell-title return.

The behavioral impact cone remains narrow:

- Pty exit still returns inference before reading any report metadata.
- Missing or stale reports still return inference unchanged.
- Fresh non-shell reports retain their prior activity, prompt, delegation, completion, and boundary behavior.
- Duplicate completion, later work, identity replacement, render presentation, and wire shape are unchanged.

## Witnesses

The exact round-2 F002 boundary witness now exits 0 and produces `{"activity":"idle","activitySource":"title"}` with no retained `finishedAt`. A direct ordinary-completion probe produces `{"activity":"idle","activitySource":"title","stateStartedAt":90000,"finishedAt":90000}`. A direct fresh-working probe produces title-owned idle activity with neither prompt nor delegations. These three probes cover both prior affected boundaries and the preservation boundary.

## Verification evidence

`bun run asm change verify-status richer-agent-status` records remediation task 5_1 passing with six new projector assertions and all earlier task gates still complete. The workflow records 592 change regressions and all other project gates passing; the two full-suite `terminal.retire` failures reproduce on the clean baseline and are outside this change.

## Specialist conclusions

- `asm-review-logic`: F002 fixed across ordinary completion, boundary clearing, fresh working suppression, pty exit, stale/missing report, fresh non-shell report, duplicate done, later work, and identity change.
- `asm-review-contracts`: F002 fixed; D2 is satisfied without widening the wire activity contract, and the new tests non-vacuously cover both prior failures and the preservation boundary.
