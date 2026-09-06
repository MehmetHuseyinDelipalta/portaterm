## 1. Shared factory contract

- [x] 1_1 Add the storage and headless-factory doubles to sessionMocks — verified: pnpm run check-types && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md#d1-target-structure, design.md#d4-allowed-non-pure-transformations, design.md#d6-claims-removed-after-the-oracle-pass
  - **Acceptance**:
    - Outcome: `sessionMocks.ts` exports two option-taking factories; type-check clean
    - Verify: command pnpm run check-types
  - **Plan**:
    1. In `src/test/sessionMocks.ts` add `sessionStorageMock(options?: { buffers?: Record<string, string> })` returning the widest member set of the six copies: `commitBufferSync(id, data)`, `commitBufferAsync(id, data, capturedGen)`, `commitIndexSync(idx)`, `commitIndexAsync(idx, capturedGen)`, `dropBuffer(id)`, `currentBufferGen(id)`, `currentSidecarGen()`, `cleanupOrphanTemps`, `scheduleLivePanelsWrite`, `writeIndexAwaited`, `writeLivePanelsAwaited`, `readBufferFile`, `listBufferFiles`, `loadIndex`, `loadLivePanels`, `bufferFilePath`, `bufferFileRelativePath`, `cancelPendingIndex`, `purge`.
    2. In the same factory implement generation bookkeeping exactly as the copies do: `commitBufferSync` and `dropBuffer` bump that id's entry in a per-id `Map`; `commitBufferAsync` returns `"stale-skipped"` when `capturedGen` differs from the id's current generation and `"renamed"` otherwise; `commitIndexSync` increments one `sidecarGen`; `commitIndexAsync` compares against `sidecarGen`.
    3. In the same factory give `bufferFilePath` the single fixed stub `` (id) => `/tmp/${id}` `` with no option, and `bufferFileRelativePath` the stub `` (id) => `snapshots/${id}.snapshot.ans` `` that all six copies already share. Add a comment recording that only `bufferFileRelativePath` is reached through the injected double, citing `src/session/SnapshotPersistence.ts:901`.
    4. In the same factory make `readBufferFile` return `null` and `listBufferFiles` return `[]` when `options.buffers` is absent; when present, back them with a `Map` seeded from it, have `commitBufferSync`/`commitBufferAsync` store into it, `dropBuffer` delete from it, and expose it as `_buffers`.
    5. In `src/test/sessionMocks.ts` add `headlessFactories(options?: { serialize?: (addonIndex: number) => string; onWrite?: (data: string) => void; track?: boolean })` returning `{ headless, serialize }`, where `headless(cols, rows)` yields `{ cols, rows, write(data, cb) { options.onWrite?.(data); cb?.(); }, resize() {}, dispose() {}, loadAddon() {} }` and each `serialize` addon calls `options.serialize` on every `serialize()` invocation, passing its own 1-based construction index, defaulting to `` (n) => `BUF#${n}` ``.
    6. In the same factory, when `track` is set, also return `builtHeadless` and `builtAddons` arrays whose entries carry a `disposed` boolean that each object's own `dispose()` sets to `true`.

- [x] 1_2 Pin the three load-bearing factory behaviours with a direct test — verified: pnpm exec vitest run src/test/sessionMocks.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d5-obligation-ledger, design.md#d2-preservation-proof
  - **Acceptance**:
    - Outcome: serialize identity, disposal tracking and the write sink each fail on mutation
    - Verify: command pnpm exec vitest run src/test/sessionMocks.test.ts
  - **Plan**:
    1. Create `src/test/sessionMocks.test.ts` covering OBL-4: the `serialize` closure is invoked once per `serialize()` call and receives a distinct construction index per addon, so a closure returning a captured value yields a stable string across repeated calls on one addon while two addons differ, and a closure incrementing its own counter yields a new string on every call.
    2. In the same file cover OBL-5: with `track`, `builtHeadless[0].disposed` and `builtAddons[0].disposed` are `false` until that object's own `dispose()` runs, and `true` after.
    3. In the same file cover OBL-6: with `onWrite`, every `write` payload arrives in order **and** the callback passed to `write` still fires.
    4. In the same file assert the two defaults the migrated suites rely on without asserting on them: `sessionStorageMock()` returns `null` from `readBufferFile` after a `commitBufferSync`, and `sessionStorageMock({ buffers: {} })` reads that write back and stops reading it back after `dropBuffer`.

## 2. Migrate the SessionManager suites (U-18)

- [x] 2_1 Move the three plain-variant suites onto the shared factories — verified: pnpm exec vitest run src/session/SessionManager.settingToggle.test.ts src/session/SessionManager.editorPanels.test.ts src/session/SessionManager.deactivate.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_2
  - **Refs**: design.md#d3-expected-test-moves, design.md#d4-allowed-non-pure-transformations
  - **Acceptance**:
    - Outcome: three suites import the shared factories; no assertion text changed
    - Verify: command pnpm exec vitest run src/session/SessionManager.settingToggle.test.ts src/session/SessionManager.editorPanels.test.ts src/session/SessionManager.deactivate.test.ts
  - **Plan**:
    1. In `src/session/SessionManager.settingToggle.test.ts` delete the local `makeStorageMock` and `makeFactories`, import `sessionStorageMock` and `headlessFactories` from `../test/sessionMocks`, and call them as `sessionStorageMock()` and `headlessFactories({ serialize: () => "X", track: true })`.
    2. In `src/session/SessionManager.editorPanels.test.ts` delete the local `makeStorageMock` and call `sessionStorageMock()`, keeping the suite's existing reference to `scheduleLivePanelsWrite` by reading it off the returned object.
    3. In `src/session/SessionManager.deactivate.test.ts` delete the local `makeStorageMock` and `makeFactories` and call `sessionStorageMock()` and `headlessFactories({ serialize: () => "BUFFER" })`.

- [ ] 2_2 Move the two concurrency suites onto the shared factories
  - **Deps**: 1_2
  - **Refs**: design.md#d3-expected-test-moves, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: both suites keep their own serialize controls and `mockImplementation` overrides
    - Verify: command pnpm exec vitest run src/session/SessionManager.persist.test.ts src/session/SessionManager.shutdownLifecycle.test.ts
  - **Plan**:
    1. In `src/session/SessionManager.persist.test.ts` delete the local `makeStorageMock` and `makeFactories`; call `sessionStorageMock()` and ``headlessFactories({ serialize: (n) => `BUF#${n}` })``, which reproduces the copy's per-addon captured value because the index is fixed per addon.
    2. In `src/session/SessionManager.shutdownLifecycle.test.ts` delete the local `makeStorageMock` and `makeFactories`; call `sessionStorageMock()`, and keep the suite's `serializeCount` and `nextSerialize` variables locally, passing a closure that returns `nextSerialize` once when set and `` `BUF#${++serializeCount}` `` otherwise, so `setNextSerialize` stays a local control the suite still returns.
    3. In both files leave every existing `storage.commitBufferAsync.mockImplementation(...)` and `storage.commitIndexAsync.mockImplementation(...)` call untouched — they override the shared double's generation decision deliberately, and they are what these suites actually assert on.

- [ ] 2_3 Move the backing-store and write-sink suites onto the shared factories
  - **Deps**: 1_2
  - **Refs**: design.md#d3-expected-test-moves, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: three suites use the `buffers` and `onWrite` options instead of local doubles
    - Verify: command pnpm exec vitest run src/session/SessionManager.hydrate.test.ts src/session/SessionManager.agentHooks.test.ts src/session/SessionManager.exit.test.ts
  - **Plan**:
    1. In `src/session/SessionManager.hydrate.test.ts` delete the local `makeStorageMock` and call `sessionStorageMock({ buffers: initial.buffers ?? {} })`, reading the seeded map back through the returned `_buffers`.
    2. In `src/session/SessionManager.agentHooks.test.ts` delete the local `makeFactories` and call `headlessFactories({ serialize: () => "OUT" })`.
    3. In `src/session/SessionManager.exit.test.ts` delete the local `makeFactories`; declare the suite's `writes` array locally and call `headlessFactories({ serialize: () => "OUT", onWrite: (d) => writes.push(d) })`.
  - **Boundary**: leave `src/session/SessionManager.snapshot.test.ts` untouched

## 3. Migrate the re-declared module mocks (I-06)

- [ ] 3_1 Replace the two re-declared trios that need no extra control
  - **Deps**: 1_2
  - **Refs**: design.md#d3-expected-test-moves, design.md#d4-allowed-non-pure-transformations
  - **Acceptance**:
    - Outcome: both suites mock through `sessionMocks` and reset `mockPtySessions` per test
    - Verify: command pnpm exec vitest run src/providers/TerminalEditorProvider.onReady.test.ts src/providers/TerminalViewProvider.restore.test.ts
  - **Plan**:
    1. In `src/providers/TerminalEditorProvider.onReady.test.ts` replace the three inline `vi.mock` factory bodies for `../pty/PtyManager`, `../pty/PtySession` and `../session/OutputBuffer` with the `ptyManagerMock()`, `ptySessionMock()` and `outputBufferMock()` forms already used by the SessionManager suites.
    2. In the same file import `mockPtySessions` from `../test/sessionMocks` and add `mockPtySessions.length = 0` to the existing `beforeEach`.
    3. Apply steps 1 and 2 to `src/providers/TerminalViewProvider.restore.test.ts`.

- [ ] 3_2 Replace the three re-declared trios that carry extra controls
  - **Deps**: 1_2
  - **Refs**: design.md#d3-expected-test-moves, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: three suites take `OutputBuffer` from `sessionMocks`, each keeping its own pty instrumentation
    - Verify: command pnpm exec vitest run src/providers/TerminalEditorProvider.test.ts src/providers/TerminalViewProvider.test.ts src/session/SessionManager.test.ts
  - **Plan**:
    1. In `src/session/SessionManager.test.ts` replace only the `../session/OutputBuffer` and `../pty/processCwd` inline mocks with `outputBufferMock()` and `processCwdMock()`, and leave its local `PtySession` class and its richly typed `mockPtySessions` array in place — per OBL-10 they capture `spawn`, `write`, `resize`, `kill`, `setShellIntegrationSink` and `shellIntegrationSink`, which the shared 3-field handle cannot express.
    2. In `src/providers/TerminalEditorProvider.test.ts` replace each re-declared module mock with the shared factory whose members this suite does not drive, spreading the shared result inside the `vi.mock` body and overriding only the members it does drive.
    3. Apply step 2 to `src/providers/TerminalViewProvider.test.ts`.
    4. In the two provider suites only, add `mockPtySessions.length = 0` to the existing `beforeEach` if they end up adopting `ptySessionMock()`; skip it in any suite that keeps its own pty class.
