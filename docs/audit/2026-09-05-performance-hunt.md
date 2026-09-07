# Audit — performance hunt

**Date**: 2026-09-05
**Base commit**: `8222f6dc`
**Companion to**: `2026-09-05-slop-audit.md` — that audit covers redundant code and tests; this one
covers measured performance.
**Method**: five axis agents plus two independent verifiers; every candidate carries a before/after
measurement. Scratch artefacts (candidate branch `perf-hunt-scratch`, patches, bench sources) lived
under a temporary directory and are not part of the repository; the patch mechanisms and numbers
below are the durable record. **Do not merge the experimental branch wholesale.** Original hunter claims are superseded by the independent verdicts below.

## Executive summary — 10 lines

1. Five axis hunters and two independent verifiers tested 12 prototype findings; four prototypes must not land as written.
2. Paused PTY buffer / 44.40 → 3.23 ms (13.75×) / 100k × 10-byte chunks; 400k: 314.86 → 15.70 ms / low risk, 40 differential profiles agree / +43−4.
3. Git descendant index / 70.514 → 0.117 ms (~601×) / 10k dirty paths × 200 directory rows / +6.65 ms attach cost; folder-path spelling corrected and reverified / +200−32 including tests.
4. Worktree row memo / 3.44 → 1.23 ms (2.8×), 190 → 19 element creations / 10 rows, one changed; 200 rows: 55.64 → 19.35 ms / low risk, 57 mutations match control / +113−9.
5. Icon cloning / 3.44 → 2.23 ms (1.54×), 20 → 0 innerHTML parses / 10 rows; 200 rows: 55.64 → 41.95 ms / low risk, byte-identical rendered HTML / +47−18.
6. Folder resolution / 434.1 → 75.6 ms (5.74×), isolated simulated-spawn benchmark / 20 workspace folders, unchanged 40 spawns, max concurrency 8 / bounded extra concurrency; real-git hunter confirms direction / +37−28.
7. Smaller options: bound revision-cache growth (10,200 → 200 entries) and avoid unused hook listener (9.054 → 5.654 ms activation); both P2.
8. Watcher deadline fixes unbounded staleness but increases refresh/git work: 0 → 3 fanouts during a 2-second stream; P2 tradeoff, not a throughput win.
9. Reject Shiki prototype (156.10 → 160.84 ms to first macrotask); do not land ignore batching, snapshot counters, or merged rev-parse until their demonstrated correctness defects are fixed.
10. Main tree and frozen budgets/config/vendor remain untouched; scoped verification only. Candidate and experimental commit inventories appear below; timings are harness measurements, not an Electron first-paint claim.

## Baseline and measurement discipline

Machine: Apple M4 Pro, 14 cores; Node 24.7.0; Bun available. Read `AGENTS.md`, `asimov/project.md`, the frozen budgets and Vitest configuration before hunting. No full `test:unit` run. Hunters and verifiers checked for existing Vitest runs before scoped runs. Concurrent performance probes and verifiers ran under varying machine load; its individual sources were not established. The sibling slop audit confirms it was static-only and ran no tests/builds. Rely on interleaved A/B and exact operation counts, not cross-run absolute differences.

| Unpatched measurement | Result | Sampling/context |
|---|---|---|
| Published presence rebuild, 10 panes × 10 worktrees | 0.3 / 0.2 / 0.1 ms | Three initial `pnpm run bench:scale` executions; each internally discards 3 warmups and reports median of 5 |
| Published model rebuild, 1 repo × 10 worktrees, real git | 31.4 / 31.0 / 32.7 ms | Same initial runs; budgets remain <50 ms / <150 ms |
| Extension bundle | 1,127,697 bytes | Production build |
| Webview bundle | 4,114,782 bytes | Production build; below unchanged 4.5 MiB ceiling |
| Cold extension require | 27.18 ms [26.47–27.71] | 10 fresh Node processes, stub VS Code |
| Activation, hooks off, no snapshots | 9.81 ms [9.13–10.34] | Hunter, 10 samples; independent A/B baseline 9.054 ms |
| Webview compile + synchronous eval | 53.12 ms [51.56–58.04] | jsdom, 10 samples; **not startup completion** |
| Webview to first macrotask | 156.10 ms [p25 155.73–p75 158.44] | Independent end-to-task measurement, 9 samples |

The actual package script runs `bench:scale` under **Bun**, despite the older header calling it a plain Node process. PTY hot-path throughput was remeasured under Node/V8 because the extension host is V8. jsdom DOM counts establish avoided operations, not Chromium layout/paint latency. Bench fixture sizes and bounds were never changed.

## Finding verdicts

| Finding | Final decision | Scoped test evidence | Landing condition |
|---|---|---|---|
| host-01 descendant index | CONFIRMED P1, corrected | 1,023 provider/integration tests; 4 new path-spelling regressions | Correction included in candidate commit |
| webview-01 row memo | CONFIRMED P1 | 1,077 worktree-view tests | Preserve complete signature encoders as row fields evolve |
| webview-02 icon cloning | CONFIRMED P1 | 1,415 worktree/vault tests | None beyond normal landing gates |
| pty-01 paused buffer | CONFIRMED P1 | 640 session/PTY tests; 40/40 independent differential cases | None beyond normal landing gates |
| model-01 folder concurrency | CONFIRMED P1 | 2,153 worktree/utils + 8 scale tests | CPU/process parallelism bounded at 8 |
| host-04 revision eviction | CONFIRMED P2 | 1,019 provider/integration tests | None beyond normal landing gates |
| startup-02 lazy hook listener | DOWNGRADED P2 | 233 agentHooks tests | Add failure-path coverage before shipping |
| host-03 watcher deadline | CONFIRMED P2 | 98 relevant watcher/host tests | Explicitly accept increased git/refetch work |
| startup-01 lazy Shiki imports | REJECTED | 229 pass / 1 invariant test fails | Not a startup win; spec unchanged |
| host-02 ignore batching | DOWNGRADED P3; do not land | 1,019 tests green despite reproduced wrong answers | Batch by verified repository, not lowest common ancestor |
| pty-02 write counter | DOWNGRADED P3; do not land | 640 tests green despite barrier failure | Epoch-aware callbacks + lifecycle regression tests |
| model-02 merged rev-parse | DOWNGRADED P3; do not land | 2,024 + 8 tests green despite fallback failure | Resolve common-dir against command cwd + nested-folder fallback test |

Green scoped tests did not excuse verifier-discovered regressions. Combined/dedicated test counts overlap; do not add them into a unique-suite total.

## P1 evidence and patch mechanisms

### host-01 — index descendant status buckets

**Location:** `src/providers/gitDecorationProvider.ts`, `getDescendantBuckets`; production caller `src/providers/fileTreeRpcHandler.ts:251`. The baseline scans all dirty paths once for every directory row. Maintain ancestor bucket counts when merged status changes instead of rescanning during reads.

| Dirty paths / directory rows | Baseline ms [min–max] | Patched ms [min–max] | Speedup |
|---|---|---|---|
| 100 / 10 | 0.101 [0.066–0.612] | 0.006 [0.005–0.012] | ~17× |
| 1,000 / 50 | 1.886 [1.831–2.058] | 0.013 [0.011–0.032] | ~145× |
| 10,000 / 50 | 18.765 [18.067–19.374] | 0.040 [0.012–0.045] | ~469× |
| 10,000 / 200 | 72.174 [71.172–74.198] | 0.113 [0.110–0.115] | 639× |

Nine interleaved samples; fresh index build increases 2.524 → 8.560 ms (~6 ms once per attach/reset). Original patch: one file +113−32, `patches/host-01-descendant-bucket-index.patch`. Key replacement: read `descendantBuckets.get(normalizedRoot)` instead of walking `mergedByPath`; increment/decrement each ancestor when a path changes bucket.

Initial independent differential: 74,060 checks, including nested repos, rename/delete/clean, detach/reattach and Windows spellings. All 73,332 normal queries agreed; all 728 trailing-separator queries failed. Current production caller uses `path.join`, so that spelling is not emitted today, but public API behavior must remain correct. The correction and four non-vacuous regression tests are folded into the candidate commit; see final correction note. The initial timing table above predates that correction; the final stack rerun below confirms its performance.

### webview-01 — reuse unchanged worktree row DOM

**Location:** `src/webview/worktree/WorktreeView.ts`, `renderListing`; `worktreeRenderSignature.ts` encoders. Cache each worktree's rendered row subtree against the existing field encoders plus clock-derived text instead of rebuilding every row for a one-row presence delta. This still scans keys; it does not claim O(1) whole-update cost.

| Rows | Created elements before → after | Listeners before → after | Median ms before → after |
|---|---|---|---|
| 10 | 190 → 19 | 60 → 6 | 3.44 → 1.23 |
| 50 | 965 → 34 | 306 → 12 | 13.82 → 4.15 |
| 200 | 3,850 → 69 | 1,220 → 26 | 55.64 → 19.35 |

Seven samples × five updates, three interleaved rounds. At 10 rows the across-round timing spread was baseline 2.46–4.78 ms versus patched 0.96–1.89 ms; counts were stable in all rounds. A 20× increase in rows produced only 3.6× as many newly created nodes after patch versus 20.3× before it.

**Correctness:** all 12 `WorktreeInfo` fields keyed; 17/19 agent fields keyed plus presented activity. The remaining `pid`/`titleSourceId` have no webview readers. 57 field/clock mutations behaved identically between baseline and patched control; two existing harness failures reproduced identically in both, not silently counted as passing assertions. Tests: 14 files / 1,077 pass. Patch: two files +113−9, `patches/webview-01-worktree-row-memo.patch`.

### webview-02 — parse constant icons once, clone per insertion

**Location:** new `src/webview/shared/iconNode.ts`; hot row icon sites in `worktreeTreeView.ts` and `vaultListView.ts`. Cache parsed SVG templates by constant markup and use `el.replaceChildren(template.cloneNode(true))` instead of repeated `el.innerHTML = ICON_*`.

| Rows | innerHTML calls before → after | Median ms before → after | Reduction |
|---|---|---|---|
| 10 | 20 → 0 | 3.44 → 2.23 | 35% |
| 50 | 103 → 0 | 13.82 → 9.85 | 29% |
| 200 | 410 → 0 | 55.64 → 41.95 | 25% |

Same interleaved DOM benchmark. Every template use clones; no template is mounted or moved between rows. All 25 relevant icons are single-root SVGs; seven rendered components were byte-identical to baseline and all inserted SVG identities unique. Tests: 28 files / 1,415 pass. Patch: three files +47−18, `patches/webview-02-icon-clone-cache.patch`. Savings overlap row memo: **do not add their individual millisecond deltas.**

### pty-01 — amortize hidden-view output-buffer merging

**Location:** `src/session/OutputBuffer.ts:170–177`. Baseline joins up to 1 MiB of paused output every 100 appends, copying old bytes repeatedly for tiny chunks. Binary-counter-style tail merging uses a 16,384-character target; retain the original whole-join cap as a backstop. Visible flush/timer/ack logic is unchanged.

| Input | Baseline ms [p25–p75] | Patched ms [p25–p75] | Speedup |
|---|---|---|---|
| 50k × 10 B | 11.81 [11.29–12.47] | 1.61 [1.60–1.61] | 7.35× |
| 100k × 10 B | 44.40 [43.54–46.50] | 3.23 [3.17–3.29] | 13.75× |
| 400k × 10 B | 314.86 [308.43–322.87] | 15.70 [15.63–15.91] | 20.05× |
| 2,560 × 4 KB | 1.75 [1.70–2.61] | 0.67 [0.65–0.69] | 2.63× |
| 1,600 × 64 KB | 0.03 [0.03–0.15] | 0.02 [0.02–0.03] | negligible absolute cost |

Seven interleaved Node/V8 samples. Independent 8 profiles × 5 seeds: byte output, per-operation buffer size, message boundaries, pause/resume counts and caps all identical, including FIFO eviction and oversized chunks. Tests: 30 files / 640 pass (both original PTY experiments were applied during this run; the counter experiment is separately disqualified). Patch: one file +43−4, `patches/pty-01-paused-buffer-amortised-coalesce.patch`. No new latency or agent stall.

### model-01 — bounded parallel workspace-folder resolution

**Location:** `src/worktree/repoRoots.ts:178–193`; extract existing `mapBounded` from `WorktreeDiscovery.ts` to `src/utils/mapBounded.ts`, not duplicate it. Resolve at concurrency 8 and reassemble by input index.

| Workspace folders | Baseline ms [p25–p75] | Patched ms [p25–p75] | Git calls before/after | Peak concurrency |
|---|---|---|---|---|
| 1 | 22.1 [21.7–22.2] | 22.1 [22.1–22.2] | 2 / 2 | 1 |
| 5 | 110.0 [109.2–110.4] | 32.5 [32.4–33.2] | 10 / 10 | 5 |
| 20 | 434.1 [433.5–436.8] | 75.6 [74.8–76.5] | 40 / 40 | 8 |

Independent seven-sample isolated benchmark: **real resolver/capability code, simulated ~10 ms git latency**, not real-git whole-tree timings. The hunter also measured real-git concurrency-only single-arm runs (seven samples): 5 folders 159.3 → 80.4 ms; 20 folders 607.7 → 279.7 ms. Hunter headline 203.0 → 80.3 and 704.8 → 257.3 ms used the **combined model-01+02 patch** and must not be attributed to model-01 alone.

All order/outcome checks passed; the watcher-specific one-git-invocation budget is unaffected. Tests: 76 files / 2,153 pass plus 8 scale tests. Patch: three files +37−28, `patches/model-01-parallel-folder-resolution.patch` (26 added utility lines; independent report's +11−28 stat omitted the new file). No win in a one-folder workspace.

## P2 options and material tradeoffs

### host-04 — stop retaining revisions for clean paths

`src/providers/gitDecorationProvider.ts`, revision-map mutation sites; sole reader `getStatus` around line 630. Delete entries once merged status is absent; `getStatus` uses the current global revision as fallback. Churn 100 / 1,000 / 10,000: baseline map 300 / 1,200 / 10,200 entries, patched 200 / 200 / 200 = live dirty paths. Exact operation/state counts, not inferred heap bytes. Current revision is monotonically at least the removed watermark, so future deltas remain newer and accepted. Tests: 39 files / 1,019 pass. One file +13−1; key hunk deletes `revisions` entries for paths whose merged status went clean. `patches/host-04-bound-revisions-map.patch`.

### startup-02 — do not bind HTTP when all hooks are disabled

`src/agentHooks/AgentHookController.ts:97–160`, blocking call `src/extension.ts:629`. Lazy runtime creation when no authority wants it; enabled hooks retain eager startup. Eleven interleaved cold-process samples: activation 9.054 [8.753–9.242] → 5.654 [5.482–6.049] ms (1.60×), server/listen counts 1/1 → 0/0. Port only reaches terminals after enabled reconciliation, so no required env is lost. Small absolute win; failure path now issues extra idempotent authority/contributor passes with a null runtime and lacks explicit regression coverage. Tests: 12 files / 233 pass. One file +61−21; `patches/startup-02-lazy-hook-runtime-bind.patch`.

### host-03 — deadline for file-tree watcher fanout

`src/providers/fsWatcherPool.ts`, `scheduleFanout` for `subscribe()` only. Add 600 ms maximum wait beside existing 150 ms trailing debounce. A quiet 100-event burst still produces one fanout; a 2-second stream at 100 ms/event produces 0 → 3 during-stream fanouts (1 → 4 total). This is freshness, not reduced work. `subscribePattern()` and worktree git burst behavior remain untouched: the scale test spanning 1,680 ms still observes exactly one git list call. Tests: 5 files / 98 pass. One file +41−4; key hunk arms one max-wait timer alongside the trailing debounce and clears both at fanout/disposal. `patches/host-03-watcher-maxwait.patch`.

Each extra refresh can spawn `git check-ignore` (~12–14 ms). At 20 active watched directories, verifier estimates ~400 ms of git work per wall second during a build. Do not count on rejected host-02 to absorb this cost.

## Disqualified prototypes — keep only as evidence

| ID | Number that reproduced | Why it must not land |
|---|---|---|
| startup-01 | Eval alone 23.70 → 18.50 ms; first-macrotask total **156.10 → 160.84 ms**, 9 samples | `main.ts:75` unconditionally preloads Shiki. Imports become microtasks, so work remains before renderer yield and adds overhead. Also breaks living static-composition MUST; 1 existing test fails. |
| host-02 | 200 → 2 git spawns, 627.2 → 83.0 ms (5 samples) | Lowest-common-ancestor batching applies outer-repo ignore rules inside nested repos. 2/35 independently checked answers wrong; the shared search consumer filters those real files out. Second-caller latency 14.3 → 28.1 ms. |
| pty-02 | 100k tiny writes: sync 14.84 → 3.35 ms, drained 37.96 → 18.97 ms (7 samples) | Disposed xterm still calls pending callbacks (5,000/5,000 verified). A recreated session mirror shares the same counter key; stale callbacks release its new barrier mid-write. Baseline holds correctly; patched fails. Needs generation/epoch tracking. |
| model-02 | 2 → 1 resolution git spawn; isolated 22.1 → 11.1 ms per folder | Bare fallback returns common dir relative to workspace-folder cwd, but patch resolves against repo toplevel. Nested folder points repoId above the real repo. Normally gated off on supported git, but fallback contract is wrong. |

Key patch hunks and complete spreads/reproduction details for these experiments remain in `findings/verify-A.md` and `findings/verify-B.md`, beside the original hunter reports and `patches/` files. Original passing tests explicitly did **not** catch the wrong-answer/barrier cases.

## Investigated, not worth changing

| Subject | Measured result / conclusion |
|---|---|
| Presence attribution | 10×10 scan ~0.018 ms; at 200×200 ~1.97 of 2.90 ms. Prefix index promising only at large scale; no production patch justified yet. |
| Presence process reads | Exactly 1 snapshot per rebuild at every measured size. No hidden per-pane `ps` loop. |
| Worktree git | No per-worktree git after list; watcher burst already exactly 1 invocation/repo. |
| Per-worktree realpath | 0.3 / 1.0 / 4.6 ms at 10 / 50 / 200; modest. |
| Full presence bridge envelope | 7.0 / 33.9 / 135.7 KiB at 10 / 50 / 200; host clone ~0.34 ms at 200. Render was the better target. |
| SQLite connection reopening | 64 queries over 10k rows: 15.39 → 10.10 ms with shared connection, ~5.3 ms; P3, no lifetime/cache redesign taken. |
| OSC parser | ~4.4 GB/s; no-newline 1 MiB probe ~23.5 GB/s. No quadratic carry rescan found. |
| Visible output batching | Already 64 KiB messages, 16 per MiB; 1.00 xterm write/message. Dispatch ~0.1 ms per 10 MiB versus ~100 ms xterm parse. |
| Webview per-chunk work | markOutput ~0.239 µs, ackChars ~0.016 µs; approval scan ~0.142–0.465 µs for Cursor, ~0.023 µs otherwise. |
| Scrollback array shift | 200k appends ~3.6 ms; no useful patch. |
| Existing backpressure | Never-acking webview causes one PTY pause; do not pause hidden agents merely to save parsing CPU. |
| Tab bar reconciliation | No-op 0 created elements / 0 added listeners; ~0.246 ms at 10 tabs. |
| Vault list | Per-group cap 10; 91 elements at both 10 and 200 input sessions. |
| Listener accumulation | Zero document/window/body listener growth over 50 rerenders. |
| File-tree refresh scope | Already per-directory debounced (150 ms), diff-spliced, viewport-bounded rerender; no whole-tree RPC refresh gap found. Read-path inspection, not a timed optimization. |
| HTML generation | ~0.0147 ms/call; file stat only once per webview creation. |
| Native PTY load / host constructor | ~0.16 ms / ~0.33 ms in activation harness. |
| Agent hook body | At 1 MiB cap ~0.56 ms total; removable JSON parse ~0.088 ms, hash ~0.34 ms. |
| Git map rebuild | ~0.66 ms/event at 10k dirty paths; upstream Git API supplies full state. |
| Exclude handling | Match ~0.167 ms at depth 40; regex compile ~2 µs. |
| Test-suite speed | Survey only: 302 test files, 51 marked jsdom. No timing improvement claimed, no full-suite run. Many apparent git-init matches were message names, not fixture work. |

These secondary measurements are hunter evidence, not independently promoted P1/P2 findings. The two unrelated agent-hook correctness suspicions in `findings/host.md` are out of this performance report's verified scope.

## Reproduction, artifacts and agents

- Candidate worktree: `../perf-wt`, branch `perf-hunt-scratch`, base `8222f6dc`.
- Original experimental stack: branch `perf-hunt-experiments` (all 12 prototypes, including rejected ones). **Never merge wholesale.**
- Per-finding patches: `patches/`; hunter bench sources/results: `bench/`.
- Independent A benches: `../vA-bench/`; detached verification worktrees `../vA-*`.
- Independent B benches: `bench/__vB.*` and `bench/vB-h2-*`; detached worktrees `../vB-*`.
- Full hunter records: `findings/startup.md`, `webview.md`, `host.md`, `model.md`, `pty.md`.
- Independent reports: `findings/verify-A.md`, `findings/verify-B.md`. Their verdicts take precedence over hunter report headings.
- TS benchmarks needing VS Code stubs use the existing mock alias or the supplied bundling/shim scripts; see each report's reproduction section. Most timing harnesses need fixtures/copies from the retained detached worktrees, not simply a bare file invocation.

Exactly seven subagents launched, all requested model `claude-opus-5[1m]`, type `general-purpose`: startup hunter (`a9d24c08e4549d371`), webview hunter (`ad342a5721f2303b3`), host hunter (`a8b002de104448f54`), model hunter (`ad0d45560c146a188`), PTY hunter (`aced3e60384ec75ee`), verifier A (`a221510a0d542e6ce`), verifier B (`aff4fe120c9772f24`). Verifier B was resumed for its own host-01 correction; no eighth agent was created.

## Final scratch state

Eight candidate commits are retained, one per finding; rejected/deferred prototypes exist only on `perf-hunt-experiments` and as patch files. No main-tree edits or stash use. Final scratch diff: **13 files, +555−117**.

### Corrected host-01

Verifier B widened the differential to 149,178 queries: **zero directory-shaped mismatches**, including trailing separators, roots, nested repositories and Windows spellings. There remain 2,698 differences for intentionally invalid inputs made by appending a separator to a dirty *file* path; these are reported, not hidden. The old scan itself answered those inconsistently, and the function contract accepts folders. Four new regression tests pass; reverting the correction makes two fail. Tests: 36 focused, 103 related, 1,023 provider/integration; type check clean.

Correction-only patch: `patches/host-01-trailing-separator-fix.patch`; already folded into host-01's candidate commit. That commit is two files +200−32, including tests. The verifier's original 0.113 ms figure was not treated as a post-fix measurement: PERF-HUNT reran the same independent interleaved benchmark against the **final candidate stack**, 9 samples (7 initial-build samples):

| Dirty / dirs | Baseline ms [min–max] | Corrected candidate ms [min–max] |
|---|---|---|
| 100 / 10 | 0.055 [0.047–0.657] | 0.006 [0.005–0.010] |
| 1,000 / 50 | 2.173 [1.986–2.223] | 0.025 [0.015–0.049] |
| 10,000 / 50 | 18.370 [17.053–19.045] | 0.046 [0.036–0.048] |
| 10,000 / 200 | 70.514 [69.775–73.613] | 0.117 [0.114–0.137] |
| Initial build, 10,000 | 2.603 [1.997–4.138] | 9.255 [8.373–11.102] |

Raw result: `final-host-index-bench.txt`. Temporary benchmark source/copy were removed from the scratch tree afterwards.

### Final candidate-stack checks

- Selected cross-patch integration run: **8 files / 413 tests pass**, 1.23 s (`final-scoped.log`). Covers git decorations, watcher pool, host scale, OutputBuffer, hook controller, repo roots, WorktreeView, file-tree RPC integration.
- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm run bench:scale`: **PASS**, presence 0.3 ms, model 32.7 ms at unchanged frozen fixtures/budgets. Model's single-folder result is expected to stay unchanged because model-02 was removed.
- Production esbuild: **PASS**. Bundle requires: **PASS**. Webview size: **3.93 MiB / 4.50 MiB (87.2%)**, PASS.
- Scoped `biome check` on the 13 changed files: **FAIL — four style errors**, no fixes applied: formatting in `gitDecorationProvider.ts`; import order in `vaultListView.ts`, `WorktreeView.ts`, `worktreeTreeView.ts`. See `final-biome.log`. These must be cleaned up before landing; type/test success is not a complete project gate.
- Both main and candidate tracked working trees were clean at handoff. Vendor, frozen budgets, fixture sizes, Vitest isolation/pool configuration were not edited.

Prototype commits are audit work product, **not release-gated changes**: no full suite was run, per assignment. Normal project landing gates remain the integrator's responsibility.

### Candidate commit inventory


```text
340cc47b perf(host-01-descendant-bucket-index): prototype
c7347a10 perf(webview-01-worktree-row-memo): prototype
b2cc9147 perf(webview-02-icon-clone-cache): prototype
28db6255 perf(pty-01-paused-buffer-amortised-coalesce): prototype
692d5f1a perf(model-01-parallel-folder-resolution): prototype
eee4e874 perf(host-04-bound-revisions-map): prototype
eb64c4ce perf(startup-02-lazy-hook-runtime-bind): prototype
6a8b2ff0 perf(host-03-watcher-maxwait): prototype
```

`perf-hunt-experiments` ends at `621e13b2`; its disqualified commits are `ed962d9e` (Shiki), `ff9c2791` (ignore batching), `2c21f160` (merged rev-parse), and `621e13b2` (snapshot write counter). Do not cherry-pick these as-is.

### Load-attribution correction

The sibling slop audit confirms it ran no tests or builds. Hunter/verifier appendices sometimes attribute observed load to the sibling audit; that attribution was not measured and is unsupported. Treat those passages only as evidence of observed load variation, not of its source. The reported interleaved measurements and counter results are unchanged.
