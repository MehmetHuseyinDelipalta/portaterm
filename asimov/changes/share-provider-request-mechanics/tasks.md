## 1. The shared mechanics

- [x] 1_1 Extract the posting primitives and the preview token registry — verified: pnpm run check-types && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md#d1-target-structure, design.md#d4-allowed-non-pure-transformations
  - **Acceptance**:
    - Outcome: `webviewRequests.ts` exports `postOnce`, `postWithRetry` and `PreviewTokenRegistry`
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Create `src/providers/webviewRequests.ts` exporting `postOnce(webview, message)`, carrying over the existing sync-throw and async-rejection swallowing unchanged.
    2. In the same file export `postWithRetry(webview, message, maxRetries, shouldAbort)`, keeping the loop bound, the default retry count, the pre-attempt `shouldAbort` bail and the 50 ms delay skipped on the last attempt exactly as both providers have them today.
    3. In the same file export `PreviewTokenRegistry` with `cancel`, `cancelAll`, `begin` and `end`, moving the `_previewTokens` map behind it and keeping `end`'s identity check and the caller-side deferred `dispose()` split intact.
    4. In the same file document, in one comment each, why disposal is deferred out of `cancel` and why the retry re-checks `shouldAbort` per attempt.

- [x] 1_2 Pin the lifecycle and asymmetry properties — verified: pnpm exec vitest run src/providers/webviewRequests.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: OBL-1, OBL-2 and OBL-3 each fail on their named mutation
    - Verify: command pnpm exec vitest run src/providers/webviewRequests.test.ts
  - **Plan**:
    1. Create `src/providers/webviewRequests.test.ts` with a fake `vscode.Webview` whose `postMessage` resolution and attempt count the test controls.
    2. In it cover OBL-1: begin A then B for one session, end A, and assert a later `cancel` still reaches B.
    3. In the same file cover OBL-2 by spying each source's `dispose` and asserting the call count is 0 after `cancel()` and exactly 1 after the owning `finally` — a readability assertion cannot fail here, per the ledger row.
    4. In the same file cover OBL-3: flip `shouldAbort` to true between the first failed attempt and the retry, and assert no second `postMessage`.
    5. Run each assertion against the mutation its ledger row names before ticking — a row whose mutation still passes is not pinned.
    6. Do not assert handler behaviour here: OBL-4, OBL-5, OBL-7 and OBL-8's module halves need the shared handlers, which `2_1` and `2_2` create. Task `2_3` covers them.

- [x] 1_3 Characterize the provider wiring before anything moves — verified: pnpm exec vitest run src/providers/providerRequestWiring.test.ts && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md#d5-obligation-ledger, design.md#d6-what-the-plan-attack-changed
  - **Acceptance**:
    - Outcome: OBL-4, OBL-6 and OBL-8 each have a wiring witness, green on the un-migrated providers
    - Verify: command pnpm exec vitest run src/providers/providerRequestWiring.test.ts
  - **Plan**:
    1. Create `src/providers/providerRequestWiring.test.ts` driving both real providers against a webview whose `postMessage` always fails and whose attempts the test counts. It must be green on the current tree before task `2_1` starts — it is characterization, not a spec for new behaviour.
    2. In it cover OBL-4's wiring half: request a subagent preview from each provider and assert the editor makes one attempt per reply while the view makes three.
    3. In the same file cover OBL-6: start a vault-sessions request on the view provider, let a rename increment the sequence while the refresh is in flight, and assert the older refresh is dropped rather than delivered.
    4. In the same file cover OBL-8's wiring half: force the file-preview failure and the vault-list failure through each provider and assert all four log strings exactly, including the editor's `(editor)` suffix.
    5. Reach each path through the providers' public message entry point rather than exporting private members for the test.
  - **Boundary**: no edits to any production file

## 2. Move the providers onto it

- [ ] 2_1 Move the three logic-identical handlers
  - **Deps**: 1_2, 1_3
  - **Refs**: design.md#d3-expected-test-moves, design.md#d4-allowed-non-pure-transformations
  - **Acceptance**:
    - Outcome: both providers keep their posted messages, ordering and log strings
    - Verify: command pnpm exec vitest run src/providers
  - **Plan**:
    1. In `src/providers/webviewRequests.ts` add shared functions for the file-preview, vault-sessions and vault-session-detail requests, each taking the webview, its deps and a `logLabel`, and each receiving the vault token plus an `isCurrent()` predicate rather than owning a counter.
    2. In `src/providers/TerminalEditorProvider.ts` and `src/providers/TerminalViewProvider.ts` replace the six handler bodies with calls to those functions, passing `this._panel.webview` from the editor and the per-call `webview` from the view.
    3. In both providers keep `_vaultRefreshSeq` and its increments where they are, passing the token and predicate down.
    4. In both providers remove any import left unused by the move.
  - **Boundary**: no edits to any existing test file

- [ ] 2_2 Move subagent preview behind an injected post
  - **Deps**: 1_2, 1_3, 2_1
  - **Refs**: design.md#d1-target-structure, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: editor still posts each subagent reply once, view still retries each
    - Verify: command pnpm exec vitest run src/providers
  - **Plan**:
    1. In `src/providers/webviewRequests.ts` add the shared subagent-preview handler and the shared `subagentResolveDeps` builder, the handler taking its posting function as a parameter.
    2. In `src/providers/TerminalEditorProvider.ts` call it with `postOnce` and in `src/providers/TerminalViewProvider.ts` with a `postWithRetry` wrapper, preserving each provider's current behaviour on all four reply paths.
    3. In both providers delete the local `subagentResolveDeps` and remove any import left unused.
  - **Boundary**: no edits to any existing test file

- [ ] 2_3 Pin the shared handlers' module-level properties
  - **Deps**: 2_2
  - **Refs**: design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: OBL-4, OBL-5, OBL-7 and OBL-8's module halves each fail on their named mutation
    - Verify: command pnpm exec vitest run src/providers/webviewRequests.test.ts
  - **Plan**:
    1. In `src/providers/webviewRequests.test.ts` cover OBL-4's module half: drive each of the four subagent reply branches under each injected post function and assert 1 versus 3 attempts.
    2. In the same file cover OBL-5 and OBL-7: exactly one cache-post attempt against three fresh attempts, and no post at all when cancellation wins the race.
    3. In the same file cover OBL-8's module half: both log labels produce their exact strings.
    4. Run each assertion against the mutation its ledger row names before ticking.
  - **Boundary**: no edits to any existing test file
