# Proposal: share-session-manager-test-fixtures

## Why

`src/test/sessionMocks.ts` exists to be the superset of the SessionManager/Pty test doubles,
but 13 SessionManager suites still hand-roll `makeStorageMock`/`makeFactories` locally, and 5
provider/manager suites re-declare the PtyManager/PtySession/OutputBuffer trio without importing
the shared module at all. Slop audit `docs/audit/2026-09-05-slop-audit.md` findings U-18 and I-06.

## Appetite

M (≤3d)

## Scope

### In scope

- Two new parameterised factories in `src/test/sessionMocks.ts` covering the SessionStorage
  double and the headless-terminal / serialize-addon factory pair.
- Widening the three existing `sessionMocks.ts` module mocks to the superset the five I-06
  suites need, so they can import instead of re-declaring.
- Migrating the SessionManager and provider suites named in U-18 and I-06 onto those factories.

### Out of scope

- Any production source file. This change edits `src/test/` and `*.test.ts` only.
- `SessionManager.snapshot.test.ts`'s factory. Its double records `calls`, `lastOptions`,
  per-addon `output` and `addonCtorCount`, and its headless `write` deliberately does not
  invoke the callback — that instrumentation is the subject under test, not boilerplate.
- U-07 and U-11, the other two deferred audit items. Separate changes.

### Must not

- Change any assertion. A suite that needs an assertion edited to pass on the shared factory
  proves the factory is not equivalent — revert the migration for that suite instead.
- Reduce the baseline test count. Growth is additive only.
- Introduce global/implicit test setup. Every shared factory stays explicitly invoked per suite,
  preserving per-file isolation.

## Risk Level

MEDIUM — the doubles encode generation invalidation, disposal tracking, serialize output
identity and output sinks that several suites assert on directly; a superset that silently
answers differently (a stubbed reader that starts returning data, a pty that starts registering
itself) turns a real failure green.
