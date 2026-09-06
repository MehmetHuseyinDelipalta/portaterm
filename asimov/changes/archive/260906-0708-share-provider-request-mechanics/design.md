# Design: share-provider-request-mechanics (refactor: the two terminal providers' request members)

## Diagnosis

| | |
|---|---|
| Target | 9 preview/vault request members duplicated across `src/providers/{TerminalEditorProvider,TerminalViewProvider}.ts` |
| Lines at start | 1296 / 1812 |
| Shape | both `god-class` (from `asm refactor shape`) — 95% / 96% of the file in one class, 42 / 52 members |
| Because | the shape's own remedy is "extract collaborators by responsibility; the class stays as a facade", and these 9 members are one responsibility present twice |
| Direct tests | 38 suites / 1027 tests over `src/providers`, plus a new `webviewRequests.test.ts` (task `1_2`) |
| Why now | Slop audit U-11, the last deferred item; caller approved the full scope after the audit's risk rationale was measured and partly falsified |

Measured at `8484a26f`, the nine members fall in three groups, not the audit's two:

```
byte-identical (40 lines)      cancelPreviewToken · cancelAllPreviewTokens · subagentResolveDeps
identical but for the webview  safePostMessage · safeSendWithRetry            (33 lines)
identical logic, threaded      handleRequestFilePreview · …VaultSessions · …VaultSessionDetail
one REAL asymmetry             handleRequestSubagentPreview  ← editor posts once, view retries
```

## Decisions

### D1: Target structure

One new module beside the providers, named for what it owns:

```
src/providers/
  webviewRequests.ts       # the preview/vault request mechanics (new)
  webviewRequests.test.ts  # its direct test (new, task 1_2)
```

`shared`, `common`, `providerUtils` are rejected here, not in review.

The webview asymmetry disappears by passing the webview in — which is what the view provider
already does internally, so only the editor provider changes, from `this._panel.webview` to an
explicit argument.

```ts
/** One attempt, fire-and-forget. Swallows sync throw and async rejection. */
export function postOnce(webview: vscode.Webview, message: ExtensionToWebViewMessage): void;

/** Up to `maxRetries` extra attempts, 50 ms apart, bailing before EVERY attempt when
 *  `shouldAbort` says this send is superseded. */
export function postWithRetry(
  webview: vscode.Webview,
  message: ExtensionToWebViewMessage,
  maxRetries?: number,
  shouldAbort?: () => boolean,
): Promise<boolean>;

/** Owns the per-session cancellation sources: supersession, disposal, cancel-all. */
export class PreviewTokenRegistry {
  cancel(sessionId: string): void;
  cancelAll(): void;
  begin(sessionId: string): vscode.CancellationTokenSource;
  end(sessionId: string, source: vscode.CancellationTokenSource): void;
}
```

Each handler becomes a free function taking the webview, the provider's services, and — for
subagent preview — **the posting function itself**, which is how the one real asymmetry is
preserved rather than decided by the module:

```ts
export async function handleSubagentPreviewRequest(
  webview: vscode.Webview,
  message: …,
  deps: SubagentPreviewDeps,
  post: (webview: vscode.Webview, message: ExtensionToWebViewMessage) => void,
): Promise<void>;
```

The editor passes `postOnce`; the view passes a `postWithRetry` wrapper. A caller that passes
the wrong one is the mutation OBL-4 catches.

Left with each provider on purpose:

| Stays with the caller | Why |
|---|---|
| `_vaultRefreshSeq` and its token comparisons | the view provider increments it at three further sites across two methods (`:743`, `:766`, `:788`) that are not duplicated members; the editor has none. Moving it widens the change past U-11 |
| the log message text | the editor logs `…failed (editor):`, the view logs `…failed:`. Passed in as a label, never normalised |
| `sessionManager` / `vaultService` lookups | per-provider wiring, handed to the functions as deps |

Clusters ordered by coupling ascending.

| # | Cluster | Members | Deps | Technique | Task |
|---|---|---|---|---|---|
| 1 | the module: posting + token registry | 5 | 0 | extract | `1_1` |
| 2 | its direct test | — | 1 | additive | `1_2` |
| 3 | the three logic-identical handlers | 3 | 1 | extract + thread | `2_1` |
| 4 | `handleRequestSubagentPreview` + `subagentResolveDeps` | 2 | 1 | extract behind an injected post | `2_2` |

### D2: Preservation proof

| | |
|---|---|
| Suite command | `pnpm run test:unit` |
| Baseline | **7878** tests / **307** files green at `8484a26f`, type-check clean. Provider-scoped: **1027** tests / **38** files — but see the flake note below |

Rules every task obeys:

- Baseline suite green after every task. A drop, or a test-file edit not predeclared in D3/D4 or
  the task's Plan, stops the task: revert, never adjust a test to fit.
- Growth is additive only; `1_2`'s Plan names the one added test file.
- Re-run `asm refactor shape` on the new module and on both providers.
- The same step failing twice means the seam is wrong, not the edit — stop and re-plan.

**Provider baseline is not provably clean.** One run of `pnpm exec vitest run src/providers`
failed a single test; four consecutive re-runs passed 1027/1027, and the failing test's identity
was not captured. Treat a lone provider failure during build as unproven rather than as this
change's regression: re-run before acting on it, and capture the name this time.

### D3: Expected test moves

**None.** No existing test file is edited. The only test change is the new
`src/providers/webviewRequests.test.ts`, added by `1_2`. The 1027 existing provider tests are the
oracle for this refactor; rewriting the oracle to fit the change would destroy the evidence.

### D4: Allowed non-pure transformations

- `1_1`: `safePostMessage` / `safeSendWithRetry` lose their `this._panel.webview` binding in the
  editor provider and take the webview as their first parameter, matching the view provider's
  existing signature. Same attempts, same delay, same bail, same return values.
- `1_1`: the five `_previewTokens` operations move behind `PreviewTokenRegistry`. The map's
  identity check on delete (`get(id) === source`) and the deferred `dispose()` move with them
  unchanged — they are the supersession contract, not incidental.
- `2_1`: the three handlers' comments differ between providers (the view provider's are fuller).
  The shared copy keeps the fuller text; a comment is not behaviour.
- `2_1`: the `(editor)` log suffix becomes a `logLabel` parameter so both strings survive
  verbatim.
- `2_2`: `handleRequestSubagentPreview` takes its posting function as a parameter. This is the
  only member where the two providers genuinely disagree, and injecting it is what stops the
  extraction from silently picking one.
- `1_1`: `cancelAll` keeps the **copied** key list both providers use today
  (`[...this._previewTokens.keys()]`), not a live `Map.keys()` iterator. No current caller
  re-enters the registry from a cancellation listener, so the two are not observably different
  now — but the copy is what the existing code does, and swapping it for a live iterator is a
  change this refactor has no reason to make.

### D6: What the plan attack changed

`asm-oracle` confirmed the D1 seam is correctly shaped — both posting primitives are
cross-provider equivalent modulo webview acquisition, all four subagent reply paths really do
differ 1-vs-3, and it found **no** unlisted behavioural string, message-field or ordering
difference across the nine members. It refuted nothing outright but left four rows `unresolved`,
all for the same reason, and corrected one fact:

| Was | Is |
|---|---|
| OBL-6: four extra `_vaultRefreshSeq` drivers in the view provider | three (`:743`, `:766`, `:788`); `:721` is a JSDoc line I miscounted from a grep |
| OBL-6's witness: the worktree and restore suites | those cover other paths entirely; no existing test races rename against an in-flight request. `1_3` adds it |
| OBL-2's witness: "the in-flight holder can still read its token" | an assertion that cannot fail — the VS Code double keeps the flag readable after dispose by design (`vscode.ts:53`). Now a `dispose` call-count assertion |
| OBL-4 and OBL-8 witnesses: the module test alone | a module test stays green when a *provider* is wired to the wrong post function or the wrong log label. `1_3` adds the wiring half |

The through-line: four of my eight witnesses tested the shared module and called that proof of
the providers' behaviour. `1_3` exists because the wiring is where this refactor can actually go
wrong, and it is written against the un-migrated providers so it is an oracle this change did
not author to fit itself.

**Mutation-checked at `1_3`, and two of the three first drafts were vacuous:**

- OBL-4's editor case asserted "one attempt" while waiting only a few macrotasks, so it passed
  whether or not the editor was wired to the retry. It now waits past both 50 ms sleeps. Fake
  timers do not work here — the retry loop interleaves sleeps with promise resolutions the fake
  clock does not drive.
- OBL-6 does **not** catch removing either supersession guard on its own: the pre-send
  `token !== this._vaultRefreshSeq` return and `postWithRetry`'s `shouldAbort` closure are
  redundant for this scenario, and killing one leaves the other. It catches what the row actually
  claims — a **second counter** — because that breaks both at once. Anyone later reading this
  test as per-guard coverage would be wrong.
- OBL-8's pair killed its mutation on the first draft.

### D5: Obligation ledger

The change touches per-session `CancellationTokenSource` objects — a disposable resource whose
leak outlives the request — and two ordering contracts (supersession and retry) that constrain
the same webview messages.

| id | claim | semantics | defeater | witness / check | disposition |
|---|---|---|---|---|---|
| OBL-1 | A superseded request never removes the newer request's token entry | `end(sessionId, source)` deletes only when the map still holds *this* `source` | Deleting unconditionally; a slow first request finishing after a second started would drop the second's entry, so the second's supersession check finds nothing and a stale preview wins | X: `src/providers/webviewRequests.test.ts` (`1_2`) — begin A, begin B for one session, end A, assert B's entry survives; catches an unconditional delete | supported |
| OBL-2 | Every request disposes its own token source exactly once | disposal is in the `finally` of the request, not in `cancel()` — deferred so in-flight `isCancellationRequested` reads stay valid | Disposing inside `cancel()`; a superseded-but-still-running request would read a disposed token | X: `src/providers/webviewRequests.test.ts` (`1_2`) — spy each source's `dispose` and assert the **count** is 0 after `cancel()` and exactly 1 after the owning `finally`. A readability assertion cannot serve here: the VS Code test double keeps `isCancellationRequested` readable after disposal on purpose (`src/test/__mocks__/vscode.ts:53`), so it stays green under the mutation | supported |
| OBL-3 | The retry bails before **every** attempt, not just the first | `shouldAbort` is checked at the top of each loop iteration, including before a retry after the 50 ms sleep | Checking once before the loop; a newer request arriving during the sleep would be overwritten by the stale retry | X: `src/providers/webviewRequests.test.ts` (`1_2`) — first attempt returns false, flip `shouldAbort` true during the sleep, assert no second `postMessage`; catches the check hoisted out of the loop | supported |
| OBL-4 | The subagent-preview posting difference survives | editor: one attempt via `postOnce` on **all four** reply paths (nested `:997`, no-session `:1006`, detail/not-found `:1011`, exception `:1017`). View: up to three via `postWithRetry` on its four (`:839`, `:849`, `:854`, `:861`) | The module choosing one; unifying on retry changes when the editor's preview lands, unifying on once drops the view's redelivery. **And** the provider being wired to the other one — a module-only test stays green through that | X: two halves, both required. Module: `webviewRequests.test.ts` (`1_2`) — each of the four branches under each injected post, attempts 1 vs 3. Wiring: `src/providers/providerRequestWiring.test.ts` (`1_3`) — drive the real providers against a webview that always fails and assert the editor makes 1 attempt and the view 3; catches a provider handed the wrong function | supported |
| OBL-5 | The vault-sessions cache post is never retried | phase 1 (`fromCache: true`) goes through `postOnce`; only phase 2 (`fromCache: false`) retries | Routing the cache post through the retry; a retried stale list could land after the fresh one and win | X: `src/providers/webviewRequests.test.ts` (`1_2`) — a webview failing every post, assert exactly one cache attempt and three fresh attempts; catches the cache post upgraded to retry | supported |
| OBL-6 | `_vaultRefreshSeq` stays provider-owned | the shared function receives the token and an `isCurrent()` closure over the provider's field; it never holds or increments the counter | Moving the counter into the module. The view provider increments it at **three** further sites across two methods — `:743` and `:766` (rename push) and `:788` (auto-refresh) — none of which are duplicated members; a second counter would let its rename push lose to an older refresh. The editor has no driver beyond its own handler (`:933`) | X: `src/providers/providerRequestWiring.test.ts` (`1_3`) — start a vault-sessions request, let a rename increment the counter while it is in flight, assert the older refresh is dropped. The suites first cited here (`TerminalViewProvider.worktree.test.ts`, `.restore.test.ts`) do **not** cover this: they hold worktree-surface and restore-path cases, and `TerminalViewProvider.test.ts:696-748` races request against request, never rename against request | supported |
| OBL-7 | A cancelled file-preview result is dropped, not posted | the post is guarded by `!source.token.isCancellationRequested` after the await | Posting unconditionally; the webview has already invalidated that requestId and would render a superseded preview | X: `src/providers/webviewRequests.test.ts` (`1_2`) — cancel during the resolve, assert no post; catches the guard dropped | supported |
| OBL-8 | Both providers' log strings survive verbatim | exactly two runtime strings differ: the file-preview warning (editor `:600` / view `:402`) and the vault-list error (editor `:948` / view `:485`). A `logLabel` parameter, never normalised | Normalising to one string in the module, **or** wiring a provider to the other's label — the two providers become indistinguishable in a user's output channel, which is how these paths get diagnosed | X: two halves. Module: `webviewRequests.test.ts` (`1_2`) — both labels produce their exact strings. Wiring: `providerRequestWiring.test.ts` (`1_3`) — force both failures through each real provider and assert the four exact strings; the module test alone stays green under a swapped label | supported |

## Risk Map

| Risk | Mitigation |
|---|---|
| The extraction silently unifies the one genuine asymmetry | OBL-4 injects the posting function rather than choosing it, and asserts 1 vs 3 attempts |
| A token source leaks or is disposed too early, surfacing only under a race | OBL-1 and OBL-2 pin both halves of the supersession contract, which is where the existing code carries review scars (`round-1 W6`, `round-2 F4`) |
| `_vaultRefreshSeq` gets absorbed and the view provider's rename push starts losing races | OBL-6 keeps it provider-owned and cites the four extra call sites by line |
| The refactor is judged by tests it also edited | D3 forbids editing any existing provider test; the 1027 stay untouched as the oracle |
| A lone provider-suite failure is misread as this change's regression | D2 records the unidentified 1-in-5 flake seen at baseline and requires a re-run before acting |
| Either provider grows a new shape | D2 re-runs `asm refactor shape` on both and on the new module |
