## 1. The shared lifecycle

- [x] 1_1 Extract the JSONL stream lifecycle into its own module — verified: pnpm run check-types && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md#d1-target-structure, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: `jsonlStream.ts` exports two async generators; type-check clean
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Create `src/vault/readers/jsonlStream.ts` exporting `streamJsonlLines(filePath: string): AsyncGenerator<{ line: string; lineNo: number }>`, which opens `createReadStream(filePath, { encoding: "utf8" })`, wraps it in `readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })`, and yields every line with a 1-based counter incremented before any filtering.
    2. In the same generator put `rl.close()` and `stream.destroy()` in a `finally` and add no `catch`, so a caller's `break` runs the cleanup while an open failure still rejects into the caller (OBL-2, OBL-3).
    3. In the same file export `streamJsonlObjects(filePath: string): AsyncGenerator<{ record: Record<string, unknown>; lineNo: number }>`, delegating to `streamJsonlLines` and, per line, trimming, skipping when empty, `JSON.parse` inside a try whose catch does `continue`, skipping when the result is null or not `typeof "object"`, then yielding the record with that line's `lineNo`. Do not add an array check — the predicate is exactly `!parsed || typeof parsed !== "object"` (OBL-1, OBL-4, OBL-5).
    4. In the same file document, in one comment each, that `lineNo` is a physical position and that the module deliberately carries no `catch` because each reader owns its own unreadable-file sentinel.

- [x] 1_2 Pin the lifecycle properties the readers depend on — verified: pnpm exec vitest run src/vault/readers/jsonlStream.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: cleanup-on-break, corrupt-line skip, non-object skip and raw-line yield each fail on mutation
    - Verify: command pnpm exec vitest run src/vault/readers/jsonlStream.test.ts
  - **Plan**:
    1. Create `src/vault/readers/jsonlStream.test.ts` writing fixtures to a temp dir, covering OBL-4: a file whose middle line is corrupt yields the first and third records, with the third's `lineNo` still 3.
    2. In the same file cover OBL-5: a fixture with one line each of `null`, `5`, `"s"`, `true`, `[1,2]` and an object, asserting exactly two yields — the array then the object — so both a narrowed and a widened predicate fail.
    3. In the same file cover OBL-1: a file with leading and interleaved blank lines stamps each record with its physical line number, not its record index.
    4. In the same file cover OBL-2: spy on `readline.createInterface` so the test holds the returned interface, consume one record then `break`, and assert `close` ran and the stream is destroyed.
    5. In the same file cover OBL-7: `streamJsonlLines` yields a leading blank line as `""` and yields an untrimmed line with its surrounding whitespace intact.
    6. In the same file assert that a missing path rejects rather than yielding nothing, which is what lets each caller keep its own sentinel (OBL-3).

- [x] 1_3 Characterize the per-caller error paths before anything moves — verified: pnpm exec vitest run src/vault/readers/readerErrorPaths.test.ts && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md#d5-obligation-ledger, design.md#d3-expected-test-moves
  - **Acceptance**:
    - Outcome: OBL-3, OBL-6, OBL-7 and OBL-8 each have a witness, green on the un-migrated readers
    - Verify: command pnpm exec vitest run src/vault/readers/readerErrorPaths.test.ts
  - **Plan**:
    1. Create `src/vault/readers/readerErrorPaths.test.ts` writing fixtures to a temp dir. It must be green on the current tree before task `2_1` starts — it is characterization, not a spec for new behaviour.
    2. In it cover OBL-3 with one case per distinct answer, using a directory path and a deleted path as the unreadable inputs: `readFirstLine`'s consumer path yields no entry, `streamClaudeRecords` and `readTeamMemberInfo` answer `null`, and `collectMemberTurns` answers the turns accumulated before a mid-read failure rather than `[]` or `null`.
    3. In the same file cover OBL-6's boundary: call `streamClaudeRecords` with an `onRecord` that throws on the second of four records, and assert the call still returns a non-`null` result and that `onRecord` still fired for the third and fourth.
    4. In the same file cover OBL-8: a file whose first line is `null` and whose second is a valid user record makes `readFirstUserRecord` answer `null`; a control file whose first line is `[1,2]` returns the second line's record.
    5. In the same file cover OBL-7's wiring: a rollout whose first line is blank and whose second is a valid `session_meta` produces no entry from the Codex JSONL fallback listing.
    6. Reach the private functions through their exported consumers rather than exporting them for the test; `readFirstUserRecord` and `streamClaudeRecords` are already exported.
  - **Boundary**: no edits to any production file

## 2. Move the readers onto it

- [x] 2_1 Move the two claudeRecords sites onto the seam each one needs — verified: pnpm exec vitest run src/vault/readers && pnpm run check-types exit 0
  - **Deps**: 1_2, 1_3
  - **Refs**: design.md#d3-expected-test-moves, design.md#d4-allowed-non-pure-transformations
  - **Acceptance**:
    - Outcome: both functions keep their `null` sentinel, the `onRecord` ordering and throw boundary, and the `null`-line stop
    - Verify: command pnpm exec vitest run src/vault/readers
  - **Plan**:
    1. In `src/vault/readers/claudeRecords.ts` rewrite `streamClaudeRecords` to iterate `streamJsonlObjects(filePath)`, dropping the local `stream`/`rl` declarations and the `finally`, and keeping the outer `try`/`catch` that returns `null`.
    2. In the same function wrap `opts.onRecord?.(rec)` and `buffer.push(rec)` in a per-record `try { … } catch {}` inside the loop, keeping the hook before the push — the generator's parse-catch no longer covers the caller's body, and without the wrap a throwing hook would turn a partial result into `null` (OBL-6).
    3. In the same file rewrite `readFirstUserRecord` onto `streamJsonlLines`, not `streamJsonlObjects`, keeping its trim, its blank-line skip, its unguarded `JSON.parse` with its inner catch, its `obj.type !== "user"` filter, its early `return`, and its `null` returns — a literal `null` line must still throw into the outer catch and end the read (OBL-8).
    4. In the same file remove the now-unused `readline` and `createReadStream` imports if no other function in it uses them.
  - **Boundary**: no edits to any existing test file

- [x] 2_2 Move the four early-exit sites in claudeReader and claudeTeam — verified: pnpm exec vitest run src/vault/readers && pnpm run check-types exit 0
  - **Deps**: 1_2, 1_3
  - **Refs**: design.md#d3-expected-test-moves, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: the four sites keep their `break`, their cleanup and their per-function sentinel
    - Verify: command pnpm exec vitest run src/vault/readers
  - **Plan**:
    1. In `src/vault/readers/claudeReader.ts` rewrite `parseClaudeFile` to iterate `streamJsonlObjects(filePath)`, keeping its `break` once `haveUser && haveAssistant`, its `fields.parsedAnyLine` bookkeeping, and its `null` return for both open failure and no parsed line.
    2. In `src/vault/readers/claudeTeam.ts` rewrite `readClaudeTeamSegment` the same way, keeping the boundary counting and the `break` at the next boundary.
    3. In the same file rewrite `readTeamMemberInfo` and `collectMemberTurns` the same way, keeping each one's limits and early returns — and keeping `collectMemberTurns`'s `catch` returning `turns` rather than a fresh empty array or `null` (OBL-3).
    4. In both files remove the now-unused `readline` and `createReadStream` imports if nothing else in them uses those.
  - **Boundary**: no edits to any existing test file

- [x] 2_3 Move the two codexReader sites, preserving the line ordinal — verified: pnpm exec vitest run src/vault/readers && pnpm run check-types exit 0
  - **Deps**: 1_2, 1_3
  - **Refs**: design.md#d4-allowed-non-pure-transformations, design.md#d5-obligation-ledger
  - **Acceptance**:
    - Outcome: rollout locators still read `#1`/`#4` across a blank line; `readFirstLine` still returns raw
    - Verify: command pnpm exec vitest run src/vault/readers
  - **Plan**:
    1. In `src/vault/readers/codexReader.ts` rewrite `streamCodexRecords` to iterate `streamJsonlObjects(filePath)` and pass the yielded `lineNo` to `stampLineOrdinal`, replacing its local counter, and keep the `try`/`catch` returning `null`.
    2. In the same file rewrite `readFirstLine` to iterate `streamJsonlLines(filePath)` and return the first yielded `line` unmodified, keeping `undefined` for both an empty file and an open failure — it must not use `streamJsonlObjects`, which would skip a blank or corrupt first line.
    3. In the same file remove the now-unused `readline` and `createReadStream` imports if nothing else in it uses those.
  - **Boundary**: no edits to any existing test file
