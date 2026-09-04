## 1. The bound the test asserts is curl's, not the scheduler's

- [x] 1_1 Assert the drain's upper bound against curl's own max-time plus a scheduling allowance — verified: pnpm exec vitest run 'src/agentHooks/install/ClaudeHookInstaller.test.ts' && pnpm exec tsc --noEmit -p tsconfig.json && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: asimov/specs/agent-hook-installation/spec.md#claude-hooks-fail-open
  - **Acceptance**:
    - Outcome: The drain tests bound by curl's max-time plus a stated allowance, keeping the 1400 ms floor
    - Verify: unit src/agentHooks/install/ClaudeHookInstaller.test.ts
  - **Plan**:
    1. `src/agentHooks/install/ClaudeHookInstaller.test.ts` — introduce one named constant beside `runD7`, `DRAIN_BOUND_MS = 1500 + 2500`, whose comment states what each term is: 1500 is `--max-time 1.5` from `CLAUDE_HOOK_COMMAND` (the bound under test), 2500 is the allowance for `/bin/sh`, `awk` and `curl` startup and teardown under a 295-file parallel vitest run — measured overshoots today were 2012, 2146, 2229 ms at load 4-6, so 500 ms of allowance asserted the machine, not the command. Replace both `toBeLessThan(2000)` at :505 and :526 with `toBeLessThan(DRAIN_BOUND_MS)`. Keep `toBeGreaterThanOrEqual(1400)` at :525 exactly — it is the half that proves the black hole was waited out to max-time rather than short-circuited, and it is the half the spec's "bounds network work" actually needs.
  - **Boundary**: `CLAUDE_HOOK_COMMAND` in `src/agentHooks/install/ClaudeHookInstaller.ts` is not edited; no `vi.useFakeTimers`, no retry wrapper, no `test.retry`, no skip.
