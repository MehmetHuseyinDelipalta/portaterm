# Design: share-jsonl-stream-lifecycle (refactor: `src/vault/readers/` JSONL frame)

## Diagnosis

| | |
|---|---|
| Target | the 8 `readline.createInterface` sites across `src/vault/readers/{claudeRecords,claudeTeam,claudeReader,codexReader}.ts` |
| Lines at start | 236 / 457 / 487 / 1385 |
| Shape | all four `unremarkable` (from `asm refactor shape`) |
| Because | "no single declaration dominates" — the defect is one frame repeated 8 times, not a shape inside any one file |
| Direct tests | 22 suites / 580 tests over `src/vault/readers`, plus a new `jsonlStream.test.ts` (task `1_2`) |
| Why now | Slop audit U-07, deferred at audit time; caller asked to finish the audit's deferred items |

Seven of the eight sites are the same frame with a different body:

```
open stream ─→ readline(crlfDelay: ∞) ─→ for await line
                                            ├─ trim, skip blank
                                            ├─ JSON.parse, skip corrupt
                                            ├─ skip non-object
                                            └─ « caller body — may break »
        catch → « caller's own sentinel »        finally → rl.close(); stream.destroy()
```

Two of the eight share only the open/iterate/cleanup part and keep their own per-line work:

- `codexReader.readFirstLine:382` neither trims nor parses; it returns the raw first line.
- `claudeRecords.readFirstUserRecord:203` parses **without an object guard** (`:216`), so a line
  that is literally `null` throws on `obj.type`, escapes the inner catch — which wraps only
  `JSON.parse` — and ends the read at the outer catch. `streamJsonlObjects` would skip that line
  and keep reading, returning a later record where today the function returns `null`. That is a
  latent bug, but fixing it is a behaviour change and this refactor may not make one.

## Decisions

### D1: Target structure

One new module, named for what it owns rather than where it sits:

```
src/vault/readers/
  jsonlStream.ts       # the JSONL read lifecycle: open, iterate, parse, always clean up
  jsonlStream.test.ts  # its direct test (new, task 1_2)
```

`utils`, `helpers`, `shared`, `misc` are rejected here, not in review. Two seams, the second
built on the first, so the one site that cannot use the parsed seam still sheds its lifecycle:

```ts
/** Every physical line, blanks included. `lineNo` is 1-based and counts every line read. */
export async function* streamJsonlLines(filePath: string): AsyncGenerator<{ line: string; lineNo: number }>;

/** Parsed non-null `typeof "object"` values — arrays included, as every call site admits today.
 *  Blank and corrupt lines are skipped but still counted. */
export async function* streamJsonlObjects(filePath: string): AsyncGenerator<{ record: Record<string, unknown>; lineNo: number }>;
```

Left in the callers on purpose — this is the line between the two, and it is what keeps the
change behaviour-preserving:

| Stays with the caller | Why |
|---|---|
| the `try/catch` and its sentinel | three different answers, per function not per module — see OBL-3. The module has no business choosing |
| every per-record exception boundary | `streamClaudeRecords:179-191` runs `onRecord` *inside* the per-line catch, so a throwing hook costs one record, not the file. The generator's parse-catch cannot cover a caller's body, so the caller re-establishes it |
| every `break` / early return | `parseClaudeFile:171` stops once title+model are found; `readClaudeTeamSegment:198` stops at the next boundary |
| bounding and buffering | `createBoundedRecordBuffer`, head+tail windows, per-caller limits |
| what a record means | `onRecord` hooks, boundary counting, field extraction, `stampLineOrdinal` |

**Deliberately not cut:** `src/vault/readers/recordLine.ts`. Its byte-bounded head/tail read is
a different mechanism, not a variant of this frame.

Clusters ordered by coupling ascending.

| # | Cluster | Sites | Deps | Technique | Task |
|---|---|---|---|---|---|
| 1 | the module | — | 0 | extract | `1_1` |
| 2 | the per-caller error-path characterization | — | 0 | additive | `1_3` |
| 3 | its direct test | — | 1 | additive | `1_2` |
| 4 | `claudeRecords.ts` — one parsed site, one thin-seam site | 2 | 1 | call-site swap | `2_1` |
| 5 | `claudeReader.ts` + `claudeTeam.ts` — early-exit sites | 4 | 1 | call-site swap | `2_2` |
| 6 | `codexReader.ts` — line ordinals and the lines-only seam | 2 | 1 | call-site swap | `2_3` |

### D2: Preservation proof

| | |
|---|---|
| Suite command | `pnpm run test:unit` |
| Baseline | **7865** tests across **305** files green at `842914b5`, type-check clean. Reader-scoped: **580** tests / **22** files |

Rules every task obeys:

- Baseline suite green after every task. A drop, or a test-file edit not predeclared in D3/D4 or
  the task's Plan, stops the task: revert, never adjust a test to fit.
- Growth is additive only; `1_2`'s Plan names the one added test file.
- Re-run `asm refactor shape` on `jsonlStream.ts` and on every reader written to — a frame moved
  into a new file that then grows its own shape has moved the defect, not removed it.
- The same step failing twice means the seam is wrong, not the edit — stop and re-plan.

### D3: Expected test moves

**None.** No existing test file is edited. The only test changes are two new files:
`src/vault/readers/jsonlStream.test.ts` (`1_2`) and `src/vault/readers/readerErrorPaths.test.ts`
(`1_3`). `1_3` is characterization: it is written against the **un-migrated** readers and must be
green before any call-site swap, so it is an oracle the change did not author to fit itself. Any
edit to an existing reader test is
an unplanned change and stops the task — the 580 existing tests are the oracle for this refactor,
and rewriting the oracle to fit the change would destroy the evidence.

### D4: Allowed non-pure transformations

- `2_1`/`2_2`/`2_3`: the six parsed sites spell one predicate three ways —
  `if (parsed && typeof parsed === "object")` accepting (`claudeRecords:181`,
  `codexReader:1062`), `if (!parsed || typeof parsed !== "object") continue` rejecting
  (`claudeTeam:186`, `:261`, `:368`), and `if (typeof parsed !== "object" || parsed === null)
  continue` rejecting with the operands swapped (`claudeReader:128`). All three are equivalent;
  the module states it once, rejecting form. All three admit `null`-excluded `typeof "object"`
  values, **arrays included** — `typeof [] === "object"`. The module must admit arrays too:
  narrowing to plain objects would change what six sites see.
- `2_3`: `streamCodexRecords`'s `stampLineOrdinal` + `buffer.push` were also inside the old
  per-line catch and are deliberately left outside the new one — unlike `streamClaudeRecords`,
  which gets the wrap above. The distinction is reachability, not consistency: `onRecord` is a
  **caller-supplied** callback whose throw is real and witnessed by a test, while these two are
  internal and cannot throw for a `JSON.parse` result (probed round 1: `Object.defineProperty`
  succeeds on every `JSON.parse` output — no frozen, non-configurable, proxy or exotic receiver
  is constructible — and `detail.ts:57-102`'s `push` never reads a record's properties).
- `2_1`/`2_2`/`2_3`: the local `stream` and `rl` variables and their `finally` block disappear
  from each caller, since the generator now owns that lifecycle. The `try/catch` around the loop
  stays.
- `2_1`: `streamClaudeRecords` wraps `opts.onRecord?.(rec)` and `buffer.push(rec)` in a per-record
  `try { … } catch {}` inside the loop. Today the hook sits inside the parse catch (`:179-191`),
  so a throwing hook is swallowed per line. Without the wrap it would land under the outer catch
  and turn a partial result into `null` while silencing every later callback. Same values, same
  hook ordering, boundary restored where the generator can no longer hold it.
- `2_1`: `readFirstUserRecord` moves to `streamJsonlLines`, **not** `streamJsonlObjects`, and
  keeps its own unguarded `JSON.parse` and inner catch verbatim, so a literal `null` line still
  throws into the outer catch and answers `null`.
- `2_3`: `readFirstLine` likewise moves to `streamJsonlLines` and returns on the first yield. Its
  current form returns the first line whatever it contains, including a blank one; the lines-only
  seam yields blanks, so this is preserved. Neither site would be preserved by
  `streamJsonlObjects`, which is why the thin seam exists.

### D5: Obligation ledger

Two hard requirements constrain the same object: the generator must **clean up on every exit
path**, including a caller's `break`, and it must **let an open failure reach the caller** so each
keeps its own sentinel. A `try/catch` inside the generator satisfies the first and breaks the
second; no cleanup at all satisfies the second and breaks the first. Both hold together because
`finally` in an async generator runs on `return()` — which `for await` calls on `break` — while
carrying no `catch`, so a rejection still propagates.

| id | claim | semantics | defeater | witness / check | disposition |
|---|---|---|---|---|---|
| OBL-1 | The Codex line ordinal stays a physical line position | `lineNo` is 1-based and increments for every line read, blank and corrupt included, before any skip | Counting only yielded records; a transcript locator then points at the wrong line whenever a blank or corrupt line precedes it | X: `pnpm exec vitest run src/vault/readers/codexReader.detail.test.ts` — `:339-359` writes a rollout with a blank line and asserts `#1` then `#4`; catches a counter moved after the blank-line skip | supported |
| OBL-2 | Every early exit still closes the interface and destroys the stream | a caller's `break`, `return` or throw runs the generator's `finally` | Putting cleanup after the loop instead of in `finally`; `parseClaudeFile` and `readClaudeTeamSegment` both break, so both would leak a handle per call | X: `src/vault/readers/jsonlStream.test.ts` — asserts the cleanup ran after a consumer breaks mid-iteration, using a spy on the readline interface; catches cleanup moved out of `finally` | supported |
| OBL-3 | Each **function** keeps its own unreadable-file answer | Three answers, not two, and not per module: `readFirstLine` → `undefined` (`codexReader:395-397`); `collectMemberTurns` → the `MemberTurn[]` accumulated before the failure, never `null` (`claudeTeam:393-395`); the other six → `null`. The generator throws rather than answering for any of them | The generator swallowing the open error and yielding nothing. Only two legs can detect that, and the witness asserts exactly those: `streamClaudeRecords` (`null` vs an empty record set) and `collectMemberTurns` (accumulated turns vs `[]`, and only on a **mid-read** failure — an open failure leaves nothing accumulated). `readFirstLine`, `readFirstUserRecord`, `parseClaudeFile`, `readClaudeTeamSegment` and `readTeamMemberInfo` answer identically on both branches, so asserting them would be a test that cannot fail | X: `pnpm exec vitest run src/vault/readers/readerErrorPaths.test.ts` (`1_3`) — the two sensitive legs, each with the control that makes it non-vacuous; mutation-checked pre-migration: `collectMemberTurns`'s `catch { return turns }` → `return []` fails it | supported |
| OBL-4 | A corrupt line is skipped and reading continues | one unparseable line yields nothing and does not end the stream; later valid lines are still delivered | `JSON.parse` outside the per-line try, or a `break` instead of `continue`; one bad line in a long transcript would truncate everything after it | X: `src/vault/readers/jsonlStream.test.ts` — a fixture whose middle line is corrupt yields the first and third records; catches parse failure ending the stream | supported |
| OBL-5 | The module's record predicate is exactly the one the six parsed sites use today | `null` and every non-`object` `typeof` (`5`, `"s"`, `true`) are skipped; **arrays are yielded**, because `typeof [] === "object"` and all six current predicates admit them | Narrowing to plain objects (`Array.isArray` reject, or a constructor check) on the theory that an array "is not a record" — six sites would stop seeing array lines they see today, silently dropping records from any transcript that has them | X: `src/vault/readers/jsonlStream.test.ts` (`1_2`) — a fixture with one line each of `null`, `5`, `"s"`, `true` and `[1,2]`, asserting exactly the array and the object line are yielded; catches both a narrowed and a widened predicate | supported |
| OBL-6 | `onRecord` keeps both its ordering and its exception boundary | `streamClaudeRecords` calls `opts.onRecord` before `buffer.push`, so a side-collector sees the middle of a transcript the head+tail window discards; and a hook that **throws** costs that one record — the hook runs before `buffer.push`, so the record never reaches the buffer either — while the file is still read to the end (`:179-191`, the hook sits inside the per-line catch). Measured, not assumed: `1_3` first asserted 4 buffered records and observed 3 | Moving the hook after the push (team-name gathering misses members in any truncated transcript), or leaving it outside a per-record catch after extraction — then one throwing hook turns a partial result into `null` and silences every later callback | X: `pnpm exec vitest run src/vault/readers/claudeReader.test.ts src/vault/readers/claudeReader.detail.test.ts` for the ordering (team-name and truncation cases) + `readerErrorPaths.test.ts` (`1_3`) for the boundary — an `onRecord` that throws on record 2 of 4 still yields a non-`null` result and still fires for records 3 and 4; catches the hook moved behind the bound and the widened catch | supported |
| OBL-7 | `readFirstLine` still returns the raw first line, and production still uses that seam | no trim, no parse; a blank first line returns as `""`, not skipped — and the wiring is what makes that observable: `readCodexJsonlMeta:243-247` turns `""` into `null` (no entry), then parses `first` **unguarded and outside any try** | Building it on `streamJsonlObjects`. A unit test on the primitive alone stays green while production is wired to the wrong one — the real damage is a rollout whose first line is blank reporting the *second* line as its `session_meta`, keyed under the wrong session | X: `src/vault/readers/jsonlStream.test.ts` (`1_2`) for the primitive + `readerErrorPaths.test.ts` (`1_3`) for the wiring — the JSONL fallback lists no entry for a rollout whose first line is blank and whose second is a valid `session_meta`; catches the thin seam being replaced by the parsed one | supported |
| OBL-8 | `readFirstUserRecord` still ends the read on a literal `null` line | it parses without an object guard (`claudeRecords:216`), so `null` throws on `obj.type`, escapes the inner catch — which wraps only `JSON.parse` — and answers `null` at `:229-230` without reading on. Only `null` does this: `5`, `"s"`, `true` and `[1,2]` all give `undefined` for `.type` and merely `continue` | Migrating it to `streamJsonlObjects`, which skips `null` and keeps reading — the function would return a later record's text and timestamp where today it returns `null`. This is a latent bug, and fixing it here would be an undeclared behaviour change | X: `src/vault/readers/readerErrorPaths.test.ts` (`1_3`) — a file whose first line is `null` and whose second is a valid user record returns `null`, plus a control where the first line is `[1,2]` and the second record **is** returned; catches the guard-less parse being replaced by the parsed seam | supported |

### D6: What the plan attack changed

`asm-oracle` confirmed OBL-2's mechanism empirically (break, ENOENT, EISDIR and a mid-read error
all run the generator's `finally` on Node 24.7) and confirmed D3 survives — no reader test mocks
`node:fs` or `node:readline`. It refuted three claims, all verified against source before
accepting:

| Was | Is |
|---|---|
| arrays are "non-records" and the test asserts `[1,2]` yields nothing | all six predicates admit arrays; the test asserts arrays **are** yielded (OBL-5) |
| all eight sites share the parsed frame; only `readFirstLine` is thin | `readFirstUserRecord` is thin too — its guard-less parse makes a `null` line terminal (OBL-8) |
| `onRecord` needs only its ordering preserved | it also needs its per-record catch re-established in the caller (OBL-6) |
| sentinels are `null` per module, `undefined` for `codexReader` | three answers, per function; `collectMemberTurns` returns partial turns (OBL-3) |
| OBL-3/OBL-6/OBL-7 lean on existing consumer tests | those tests are not open-failure witnesses; `1_3` adds real ones against the un-migrated code |

**Follow-up, deliberately not taken here:** `readFirstUserRecord`'s missing object guard means one
`null` line costs the whole title lookup. OBL-8 pins the current behaviour so the refactor cannot
change it by accident; fixing it is a separate behaviour change with its own spec delta.

## Risk Map

| Risk | Mitigation |
|---|---|
| An error path changes shape and no test notices — the readers' least-covered behaviour | `1_3` writes the per-caller error-path witnesses against the **un-migrated** readers, so they are an oracle this change did not author to fit itself; OBL-3, OBL-6, OBL-7 and OBL-8 all cite it |
| A file handle leaks on the two early-exit sites, surfacing only under load | OBL-2's witness asserts cleanup after a mid-iteration `break`, which is the exact shape both sites use |
| The line ordinal drifts, degrading a user-visible transcript locator quietly | OBL-1's witness already exists at `codexReader.detail.test.ts:339-359` and was written for precisely this property |
| The refactor is judged by tests it also edited | D3 forbids editing any existing test; the 580 reader tests stay untouched as the oracle |
| `jsonlStream.ts` grows into its own shape | D2 re-runs `asm refactor shape` on it and on every reader written to |
| The two-generator chain costs ~1.4x per line (round 1 F002: 51-63 ms → 78-88 ms over 200k lines / 51.8 MB) | Accepted, not fixed. The only fix collapses the two seams back into one and re-duplicates the lifecycle this change removes. It reaches just the two read-to-EOF callers (`streamCodexRecords`, `streamClaudeRecords` on detail open) — listing breaks early on both readers — and those reads are already head+tail bounded. The number is Bun-measured; the extension host is Node, so re-measure there before acting |
