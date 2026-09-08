# Workflow State: compact-worktree-dialog

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved — user approved revised single-column UI in conversation
- [x] `asm change validate` passes
- [x] Gate 2: plan approved — user requested a persistent create footer and corrected normal-width status-chip alignment

## Implement

- [x] All tasks done (`tasks.md`)
- [ ] Verify gate: type check, check-mode lint, I10, all 8128 tests and independent-scroll/ultra-narrow browser matrices passed; latest extension bundle and native VS Code panel-size interaction not run.
- [ ] Review done — prior Oracle audit corrected; no post-fix Oracle review requested.
- [ ] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change.

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Admission: in-contract — existing worktree creation UI; presentation only
Planned at: 3766b9bc

Must-nots: no auto-consent, provider persistence changes, missing launch modes, hidden shared-main warnings or recovery behavior changes.
Approval: user explicitly requested implementation of the revised UI; no remaining product forks.
Real-dependency: task 2_1 — render the real dialog module and stylesheet in a local browser harness; retain runtime screenshots as verification evidence.

Verification: browser harness uses the real dialog and stylesheet with a simulated host, not a running VS Code extension. Widths 390/640/1024 and light/dark checked; local preview http://127.0.0.1:43127.
Build skipped: per user preview preference, no extension build, install, Cursor launch or reload was performed.
Witnesses: I10 pass exit 0; existing assembly and view witnesses passed in the full unit suite.
Sizing warning: task 2_1 spans the single form composition plus cross-surface test locator migrations; no independent product slice or backend behavior added.
Commits: none — user requested UI edits, not commits or archive.

Review handback: user approved sparse-state refinement, conditional setup wait and advanced defaults relocation; no new owners or policy changes; parent/child none.

Sparse preview: real dialog and CSS, simulated host; desktop height 443px, narrow height 488px; no horizontal overflow at 390/560/1024px. Light/dark, selected setup, explicit overlap choice, advanced defaults, long provenance and warnings verified.
Full-suite first attempt: 8101 passed, one 5000ms timeout in src/worktree/adoptWorktree.integration.test.ts:183. All 17 tests in that unchanged file passed when rerun alone; the final full suite passed all 8102 tests without code or timeout changes.

Validation warning disposition: preserve the existing scheduling contract as one modified requirement; completed task sizing and outcome wording are non-blocking documentation warnings, with runnable verification recorded for every task.

Review handback: user requests one-line file choices after workspace environment suggestions rendered three lines; preserve visible warnings and full-path access; no new owners or backend changes.

File-row verification: four workspace .env suggestions each render at 26px with the complete inline secrets warning at viewport widths 390/560/1024px. Selection, collapse/reopen, path ellipsis and full hover text passed; setup layout unchanged.

Explicit preview request: built the latest extension and passed build:check-requires; opened a new VS Code Extension Development Host for this repository. Window confirmed via code --status. Manual UI testing is left to the user; existing editor windows were not reloaded or closed.

Review handback: approved short-viewport footer, targeted file review, bounded shared warnings and explicit setup order/counts; no new policy owners; parent/child none.
Bound: presentation scans only the existing host-bounded offer (MAX_MODEL_ROWS = 200), not a growing external collection.

Responsive verification: eight CSS viewport sizes from 320×240 to 1440×900 (also 560×1200), actual Tab traversal and 40-option branch navigation passed. A 200-row offer kept 140 routine copies collapsed with one review row, 20 links in a 16.5px summary and 39 unchecked commands; see verification/density-browser-results.json.
Additional states: no offer, empty model, unavailable agents, all-dangerous agents, pending host input, expanded prompt/defaults, long paths/scripts and light theme passed in the simulated-host browser. Wrapped footer feedback was injected for geometry testing. CSS viewport tests cover reduced space analogous to zoom, not actual VS Code zoom controls.
Verification corrections: initial full run caught an old assembly file-order assertion and a new test that incorrectly assumed unsolicited offers carry consent. Migrated the file-order assertion and exercised retention through an explicit host input; final 333 suites / 8111 tests passed. No selection policy changed.
Preview boundary: did not rebuild the extension, reload or open the user's editor for this follow-up; the previously opened VS Code window still has its prior bundle. Existing staged changes were left intact; follow-up edits remain unstaged.

Review handback: user approved full-surface creation in low panels, two columns when wide, explicit host-panel expansion, and narrow Vault header correction. Preserve draft and lifecycle; no auto-maximize; parent/child none.
Explicit rebuild follow-up: the prior bundle was rebuilt and build:check-requires passed on request; automated reload was blocked by macOS Accessibility and left to the user.

Admission: in-contract — existing modal and Vault navigation owners; one payload-free internal UI action, no new host lifecycle or durable state owner.
Panel command evidence: installed VS Code 1.130 implements workbench.action.toggleMaximizedPanel, not a maximize-only command; action wording states the toggle. Host location guards exclude sidebar/editor, with no automatic invocation.
Overlay lifecycle: reuse the existing shell and DOM throughout resizing; no body-mounted replacement or new teardown owner (project_body_overlay_disposal memory).

Adaptive verification: full-surface/two-column versus compact-modal boundaries passed at 320×240, 390×350, 759×560, 760×560, 850×300, 1100×320, 1100×561 and 1024×900. Resizing retained the same focused prompt, values, ticks and disclosures; Tab traversal and the prior 200-row/browser matrix passed. See verification/adaptive-browser-results.json.
Narrow Vault verification: actual VaultPanel header widths 150–400px inside a 1100px webview passed non-overlap and action bounds for both bodies; named icon tabs, selection, search, create and viewport-sized child modal checked. Header-only containment does not capture the dialog.
Host-action verification: payload-free command dispatch passed for the live panel provider; sidebar and retired-view requests rejected. Form activation never submits or recreates the draft; sizing listener and stale action clean up on dispose, Cancel, Escape and scrim exits. Native VS Code command execution remains a manual check; no new build/reload performed in this iteration.

Review handback: user exposed header overlap below the previous 150px test floor and requested independent preparation scroll. Keep neutral panel toggle available rather than guessing native maximized state from viewport height; no host-policy change.

Screenshot follow-up: real row-renderer reproduction at 100px showed zero-width branch labels and main/open marks beyond the row edge. The user-reported narrow Vault repair includes retaining these visible row statuses, not only separating header buttons; task 7_3 owns this CSS correction.

Ultra-narrow verification: 80, 100, 120, 140, 150, 180, 210, 280 and 400px headers passed both bodies, expanded/collapsed sizing, pairwise bounds, actual center hit targets and real Search/Create clicks. The real worktree row renderer kept visible branches and complete main/open/locked/missing marks plus row actions. See verification/ultranarrow-browser-results.json.
Scroll correction: before fix, a 500px body scroll moved launch controls by -500px; after fix, preparation scrolled 500px while body and right-column position stayed unchanged. Real wheel input and 220 Tab moves through a 200-row offer passed; oversized secondary content remains independently accessible.
Panel affordance correction: neutral Panel height toggle remains available at both heights; removed the resize listener and all viewport-based guesses about native maximized state. Existing host location/liveness guards and explicit-only dispatch remain unchanged.
Preview cache correction: initial browser reload served stale CSS; raw served HTML differed from the document stylesheet. Disabled HTTP caching through Playwright routing and reran the measured browser witnesses against current CSS before recording passes. No native editor build or reload performed for these edits.

User follow-up: add a create action below populated repo lists while retaining the existing main-only state; remove empty action space after status chips at normal widths. Existing no-match/collapsed-repo behavior and host callbacks stay unchanged.

Pilot checkpoint: user authorized committing current UI work before a matched three-file test-pruning experiment. Type check, check-mode lint (seven existing warnings), I10 and full unit suite passed after fixing a footer-test callback lint error. No new extension build or native editor interaction. Phase-8 browser matrix/report remains incomplete; the Verify gate stays open.
Pilot protocol: Luna then Terra on identical committed tests, disjoint per-file edits, snapshots before exact-file restoration; independent blind Opus and Sol judgments. No candidate is adopted automatically.
