# Tasks: close-the-disk-door-on-a-refuted-session

## 1. The door step 2 closed and step 3 left open

- [x] 1_1 Name the refuted sessions to the disk selector, and make it walk past them — verified: chair Witness verbatim && pnpm exec vitest run src/session/resolveClaudeSession.test.ts src/providers/subagentResolveDeps.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/claude-running-session-map/spec.md#map-a-terminal-to-its-claude-session; asimov/changes/archive/260906-0758-refuse-a-directory-match-the-process-table-refuted/.reviews/round-1.md#f001
  - **Acceptance**:
    - Outcome: a refuted live transcript is skipped and the older exited one is returned
    - Verify: unit src/providers/subagentResolveDeps.test.ts
  - **Plan**:
    1. `src/session/resolveClaudeSession.ts` — `newestSessionUnderCwd(cwd, exclude)`; when the subtree was refuted, `exclude` is every live registry session id, and a returned id inside it is refused.
    2. `src/providers/webviewRequests.ts` — the shipped selector `continue`s past an excluded entry rather than ranking it, so a newer refuted transcript cannot mask an older eligible one.
    3. `src/session/resolveClaudeSession.test.ts` — the masking case, the ignored-exclusion case, and the unreadable-table case that must exclude nothing.
    4. `src/providers/subagentResolveDeps.test.ts` (new) — the shipped selector at its own seam, where the resolver's re-check cannot stand in for it.
    5. Arm-check both ends by removing each guard in turn.
  - **Boundary**: step 3 stays reachable for exited sessions, presence's `null` disk fallback is untouched, and nothing is excluded where no process table could be read
