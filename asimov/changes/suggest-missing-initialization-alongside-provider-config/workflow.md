# Workflow State: suggest-missing-initialization-alongside-provider-config

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — fail-closed policy: only provider answers explicitly marked complete receive missing unchecked suggestions
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — changes initialization suggestion behavior and saved-config rereads | flags: security-privacy
Planned at: 4a4ebb3e
Baseline: current `readProvisioning` calls suggestions only when `chosen === null`; the archived fallback design explicitly suppresses them over every present source. This change reverses only that condition for readable answers.
Plan attack: refuted and repaired four boundaries — workspace manifests now use a bounded no-follow reader; candidate ids are minted disjoint before contender membership; capacity synchronizes to `rowsOf(base)` but never refunds a capped read; completeness is required on `AdapterRead` and propagated through native assembly rather than guessed from problem reasons. Supported: exact setup script identity, non-native save/reread semantics, and fresh source-switch reads. The warning remains present; its icon move stays a separate webview change.
Biome exception: `pnpm exec biome check src` exits 1 only on untouched `src/agentHooks/AgentHookController.test.ts`; clean base `1206b059` has the same formatter error plus one more, while all other diagnostics match.
Archive handback: the delta now modifies the canonical suggestion requirement names and preserves existing workspace-directory detection; implementation behavior is unchanged.
