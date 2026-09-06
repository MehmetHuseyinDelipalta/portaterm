# Review round 1 — share-jsonl-stream-lifecycle

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: commit range `842914b5..HEAD`
- Head: `a62c74b917486e16f66e1e29320744c1f2190642`
- Tree state: clean for the reviewed paths. Two uncommitted items exist outside the range and were not reviewed — `.gitignore` (adds an ignore for `.claude/commands/asimov-brd-review-start.md`) and untracked `docs/audit/2026-09-05-performance-hunt.md`.
- Reviewable lines: 95 added across 5 production files (`claudeReader.ts` 2, `claudeRecords.ts` 14, `claudeTeam.ts` 4, `codexReader.ts` 11, `jsonlStream.ts` 64); 283 added across 2 new test files reviewed inline (Phase 2.5). Change artifacts under `asimov/changes/` are `*.md` — skipped as files, read as intent context.
- Agents spawned: 6 (logic ×3, contracts ×1, reuse ×1, performance ×1) + chair self-review and full-flow trace. Agents skipped: data-security (no auth, secrets, DB, network or user-input surface in the diff), frontend (no webview/React code in the diff).
- Registry audit: not applicable — `docs/DESIGN.md` has no `Cross-Cutting Invariants` section.
- Verify evidence cited, not re-run: `bun run asm change verify-status share-jsonl-stream-lifecycle` → all six tasks exit 0. workflow.md records 7878 tests / 307 files green, type-check clean, `pnpm exec biome check` exit 0 scoped to this change's seven files (three pre-existing findings elsewhere named in Notes), `asm refactor shape` `unremarkable` on all five touched readers plus the new module, and OBL-1..OBL-8 each run individually as passing.
- Verdict: WARN
- Counts: Blocking 0 | Warnings 2 | Suggestions 1

## Preservation verdict

`specs/NO-DELTA.md` holds. No reviewer — three independent logic lenses, one contracts lens, the
chair self-review, and the full-flow trace — found any input for which a reader now returns a
different value. The four preservation points the caller flagged were each independently
confirmed:

1. **Array-admitting predicate.** `!parsed || typeof parsed !== "object"` at `jsonlStream.ts:59`
   is the De Morgan contrapositive of `parsed && typeof parsed === "object"`
   (`842914b5:claudeRecords.ts:181`, `842914b5:codexReader.ts:1062`) and equivalent to a **third**
   original form the design's D4 table does not list — `typeof parsed !== "object" || parsed === null`
   at `842914b5:claudeReader.ts:128`. Checked over `null`, `{}`, `[]`, `0`, `""`, `false`, numbers,
   strings, booleans: no JSON value on which the three disagree. Arrays are admitted by all three.
2. **OBL-8 preserved.** `readFirstUserRecord` keeps `streamJsonlLines` and its guard-less
   `JSON.parse`; a literal `null` line still throws on `obj.type`, past a parse-only inner catch.
   The throw from the caller's body runs the generator's `finally` (cleanup) and then reaches the
   outer catch unmasked, so the answer is still `null`. Probed on Node 24, not reasoned from spec.
3. **OBL-6 preserved.** `streamClaudeRecords`'s re-established per-record `try { onRecord; push } catch {}`
   keeps hook-before-push ordering, still fires for records the head+tail bound later drops, and a
   throwing hook still costs exactly that one record (it never reaches the buffer) while the file is
   read to the end. Rejected promises from an async hook remain unawaited, as before.
4. **OBL-3 preserved.** `collectMemberTurns` returns the same mutated `turns` array object from its
   `catch` on a mid-read rejection. The rejection path was walked end to end: generator `finally` →
   rethrow through `streamJsonlObjects`'s inner `for await` → caller's `catch` → `return turns`.

The adversarial lifecycle question was answered empirically rather than from the spec. A Node 24
probe over the module's own shape, with one shared cleanup counter, produced `closes=1 destroyed=1`
for **break at two generator levels, return at two levels, throw at two levels, and break at one
level**, with the original error surviving the throw case. `streamJsonlObjects` carrying no
`try/finally` is correct rather than a gap: its consumer's close resumes it at its `yield` with a
return completion, which forces AsyncIteratorClose on its own `for await` over `streamJsonlLines`,
running that generator's `finally`. Open failures (`ENOENT`, `EISDIR`) reject through both
generators into each caller's own `for await` with cleanup run and the error neither doubled nor
swallowed. A synchronous `createReadStream` throw leaves both locals `undefined` and the optional
calls are no-ops. `lineNo` is the physical 1-based position under CRLF and under a missing trailing
newline, with no phantom last line.

Two secondary confirmations: the OBL-1 witness at `codexReader.detail.test.ts:339-359` does assert
what the design claims (`#1` then `#4` across a blank line), and no early-exit reader consumes more
of the file than before (an early-break comparison read the same first 64 KiB on both sides).

## Findings

### F001

- Severity: WARN
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-contracts
- Class: feature
- File: src/vault/readers/jsonlStream.ts:47
- Title: The parsed seam's exported type excludes a value it deliberately yields
- Evidence: `streamJsonlObjects` is declared `AsyncGenerator<{ record: Record<string, unknown>; lineNo: number }>` but by design (OBL-5, and `jsonlStream.test.ts:54-66`) yields arrays, since `typeof [] === "object"`. The cast at `:62` hides the mismatch. The same unsoundness existed pre-change as a local `parsed as Record<string, unknown>` at each of the six sites, so this centralizes rather than introduces it — but it is now an exported signature a future consumer can read as a promise.
- Impact: A later consumer of the shared seam may write code that assumes string-keyed record access is safe and be handed an array. No current consumer is affected: all six existing sites did the identical cast before and index by string key on both shapes.
- Reach: none — no shipped behaviour changes; the divergence is between the declared type and the runtime value, and every existing consumer already tolerated it.
- Adjudicated-by: chair
- Adjudication: Compared the declared type against all six pre-change casts at `842914b5` (`claudeReader.ts:128`, `claudeRecords.ts:181`, `claudeTeam.ts:186/:261/:368`, `codexReader.ts:1062`). Each already cast an array-admitting parse to `Record<string, unknown>`, so no runtime path changes. The only new exposure is the exported signature.
- Witness: none — no behavioural delta to witness; the defect is a type/runtime contract mismatch.
- SuggestedFix: Widen to `Record<string, unknown> | unknown[]` (or a named `JsonlValue` alias) and let the callers that index by key refine it, or keep the cast and document on the signature that arrays are admitted deliberately.
- Status: accepted
- Triage: Accepted as documentation, not a widening. `Record<string, unknown> | unknown[]` would force all six call sites to refine a union they currently do not have; each indexes by string key on both shapes, which is exactly what the pre-change casts did. Refining would either add casts that buy nothing or drop arrays — a behaviour change this NO-DELTA refactor may not make. Documented on the signature instead; a real widening is a follow-up with its own delta.

### F002

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-performance
- Class: feature
- File: src/vault/readers/jsonlStream.ts:29
- Title: The two-generator chain adds ~1.4x to the per-line read loop on unbounded transcripts
- Evidence: A scratch benchmark over a 51.8 MB / 200,000-line JSONL file compared the pre-change `readline` loop from `842914b5:codexReader.ts` against the new `streamJsonlObjects` → `streamJsonlLines` chain: 51-63 ms old vs 78-88 ms new, ~22-26 ms added, ratio ~1.4-1.5x. Each physical line now crosses two extra async-generator yield boundaries and allocates two short-lived wrappers (`{line, lineNo}`, then `{record, lineNo}`) that did not exist before. Growth axis: physical lines per transcript, explicitly unbounded — `claudeRecords.ts:159-161` already anticipates "a tens-of-MB transcript".
- Impact: Bounded to the two functions that read a transcript to EOF — `streamCodexRecords` and `streamClaudeRecords`, i.e. the session-detail open. Not the listing path: `parseClaudeFile` breaks at title+model and `readCodexJsonlMeta` reads one line via `readFirstLine`, so neither pays the full-file cost. On the largest transcript the code anticipates this is ~25 ms of extra latency on a detail open, linear in the same axis as before — a constant factor, not a complexity change. No structural cap is removed and nothing accumulates.
- Reach: none — no data loss, wrong target, crossed boundary or broken flow; a sub-100 ms latency delta on the largest anticipated input.
- Adjudicated-by: chair
- Adjudication: Traced both consumers of the parsed seam to their entry points to bound the blast radius, which corrects the finder's "both session listing and detail reads" — listing does not read to EOF on either reader (`claudeReader.ts:148-151` breaks; `codexReader.ts:241-244` reads one line). Also noted the harness: the benchmark ran under Bun, while the extension host runs Node, so the measured ratio is indicative rather than the shipping number. Priority reduced P2 → P3 on that evidence delta; severity held, since the measurement itself stands.
- Witness: none — not a gating blocker; a re-measurement under Node on the detail path would be the check if this is ever pursued.
- SuggestedFix: Only if a measurement on the real runtime justifies it: inline the parse/guard into a single generator that also exposes the raw-line mode, keeping `streamJsonlLines`'s separate behaviour. Weigh against the readability the two-seam split buys — the split is what lets the two lines-only callers shed their lifecycle without inheriting the parse (OBL-7, OBL-8).
- Status: accepted
- Triage: Accepted as a recorded tradeoff, no code change. The only fix is to collapse the two generators into one, which re-duplicates the lifecycle U-07 exists to remove — a bad trade for ~25 ms on the largest transcript the code anticipates, on a path that is already head+tail bounded. Recorded in design.md Risk Map with the chair's two corrections kept: the cost hits only the two read-to-EOF callers, and the number is Bun-measured, not the shipping runtime. Re-measure under Node before acting.

### F003

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair; asm-review-logic
- Class: feature
- File: src/vault/readers/codexReader.ts:1041
- Title: `streamCodexRecords` narrowed its per-record exception boundary without the OBL-6 treatment
- Evidence: At `842914b5:codexReader.ts:1055-1067` the per-line `try { … } catch { /* skip a corrupt line, keep reading */ }` wrapped `JSON.parse` **and** `stampLineOrdinal(parsed, lineNo)` **and** `buffer.push(parsed)`. After the migration the generator's catch covers only `JSON.parse`, so both calls sit outside any per-record boundary at `:1041-1044`; a throw from either would reach the function-level catch and answer `null` for the whole file where it previously cost one record. This is the identical shape design.md OBL-6 identified for `streamClaudeRecords`, where task 2_1 did re-establish a caller-side per-record catch. Task 2_3 did not, and neither D4 nor the ledger records the asymmetry.
- Impact: None reachable. Documentation/consistency only: the ledger reasons about this boundary in one of the two places it existed, leaving a future reader to rediscover why the other was safe to drop.
- Reach: none — no JSONL input reaches the changed boundary.
- Adjudicated-by: asm-review-contracts
- Adjudication: Probed `Object.defineProperty(rec, "__lineOrdinal", { value: n, enumerable: false })` under Node against JSON.parse outputs `{}`, `[]`, an object already carrying `"__lineOrdinal"`, `"__proto__"`, constructor/prototype keys, and a 100,000-key object — all stamp successfully; JSON.parse cannot construct a frozen object, a non-configurable property, a proxy or an exotic receiver. Read `detail.ts:57-102`: with the default caps (100 head + 4000 tail) `push` does `Array.push` until record 4101, then one fixed copy into head + a fixed 4000-slot ring, never reads record properties and has no record-dependent operation. The adjudicator's conclusion: reach `none`, and it would not report the finding.
- Witness: none — no reachable input to witness.
- SuggestedFix: No code change. Add one line to design.md § D4 recording that `streamCodexRecords`'s body was also inside the old per-line catch and was deliberately left outside the new one because neither `stampLineOrdinal` nor `buffer.push` can throw for a `JSON.parse` result.
- Status: accepted
- Triage: Accepted; the asymmetry is real and was mine — I reasoned about this boundary for `streamClaudeRecords` and did not carry it to `streamCodexRecords`. No code change, per the adjudicated reach of `none`. The line the finding asks for goes in D4, and states the actual distinction: `onRecord` is a caller-supplied callback whose throw is reachable and witnessed by a test, while `stampLineOrdinal` and `buffer.push` are internal and cannot throw for a `JSON.parse` result.

## Inline support review (Phase 2.5)

Both new test files are real-filesystem fixtures under `mkdtemp`, cleaned up in `afterEach`. No
`.only`, no `.skip`, every async assertion awaited, no PII or secrets in fixtures. No existing test
file was edited, which is design D3 — confirmed against the diff, and it is what keeps the 580
pre-existing reader tests an oracle the change did not author to fit itself.

`readerErrorPaths.test.ts` was written against the un-migrated readers and its mutation checks are
recorded (`collectMemberTurns`'s `catch { return turns }` → `return []` fails it; the OBL-6 case
first asserted 4 buffered records and observed 3). Its `node:readline` mock at `:63-72` still binds
after the migration — Vitest's `doMock` keys by resolved specifier, so it now intercepts
`jsonlStream.ts`'s import rather than `claudeTeam.ts`'s, exercising the same path. Two limits worth
recording, neither a defect: the mock replaces the module wholesale rather than spreading the actual
one (it needs only `createInterface`), and the file does not directly cover missing-file, blank-only,
corrupt-only, truncated-line or scalar-line classes for `claudeRecords` — those were covered instead
by line-by-line comparison against `842914b5`, which found no divergence.

## Sub-agents spawned

- asm-review-logic: `jsonlStream.ts` + its test — async-generator lifecycle, cleanup on every exit
  path, error propagation, predicate equivalence — opus[1M] — clean
- asm-review-logic: `claudeRecords.ts` — the two migrated sites, OBL-6 and OBL-8 — gpt-5.6-terra[1M]
  — clean
- asm-review-logic: `claudeReader.ts` + `claudeTeam.ts` — the four early-exit sites, OBL-2 and OBL-3
  — sonnet[1M] — clean
- asm-review-contracts: `codexReader.ts` — line ordinal OBL-1, raw seam OBL-7, seam contracts —
  gpt-5.6-terra[1M] — F001; also adjudicated F003
- asm-review-reuse: whole diff — did the extraction remove the duplication or relocate it, missed
  sites, `recordLine.ts` exclusion — gpt-5.6-luna[1M] — clean
- asm-review-performance: `src/vault/readers/` — per-line cost on the unbounded lines-per-transcript
  axis — gpt-5.6-luna[1M] — F002
