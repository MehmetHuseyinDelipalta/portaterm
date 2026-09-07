# Proposal: decompose-create-dialog

## Why

`WorktreeCreateDialog.ts` is 3664 lines and `openWorktreeCreateDialog` is 2690 of them. The standing
goal is every one of these files, and every file extracted from them, under 500 LOC.

## Scope

The whole file, in one change with tasks ordered safest-first — not one change per slice. The cuts are
mechanical moves proved by `tsc` and the 386-case dialog suite; a separate plan/oracle/review cycle per
slice costs more than the cuts do.

Two classes of task, and the order matters:

1. **Module-level moves** — code already at module scope with no closure capture. Import lists change;
   no body does.
2. **Closure collaborators** — state currently held in `openWorktreeCreateDialog`'s scope. Each becomes
   a factory with an explicit deps interface. This is where the risk is: the state is read across the
   whole closure, not at a few call sites.

## Non-goals / must-not

- No behaviour change. `WorktreeCreateDialog.test.ts` (386 cases) is the regression net and is not
  edited.
- No fix for `checkedByOffer` being keyed by offer id alone. A plan attack found no test reuses one
  offer id across two repositories, so a collision there is uncovered — but it is pre-existing
  behaviour and a behaviour-preserving change may not touch it. Recorded as a follow-up.
- No new capability, no wire-format change.

## Appetite

Ten tasks. Every destination lands under 500 LOC, including the facade.

## Risk

The plan attack refuted this change's first shape: the provisioning state was proposed as a
three-call-site cluster and is in fact read at ~40 sites from `:1395` to `:3490`. Any cluster's
boundary is assumed wrong until its free names are enumerated in BOTH directions — what the range
reads from outside, and what outside reads from the range.
