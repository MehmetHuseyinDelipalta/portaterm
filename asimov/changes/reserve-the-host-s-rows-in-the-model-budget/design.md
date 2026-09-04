# Design: reserve the host's rows in the model budget

## Decisions

### D1: One reserved count, spent by the reader, owed to the host

```ts
// src/worktree/provisioning/providerKit.ts
export const MAX_MODEL_ROWS = 200;
/** Rows the host may compose onto a read before it publishes. */
export const HOST_COMPOSED_ROWS = 3;
/** What one read may emit, message slot and host slots reserved. */
export const MAX_READ_ROWS = MAX_MODEL_ROWS - HOST_COMPOSED_ROWS - 1; // 196
```

`full()` compares against `MAX_READ_ROWS` instead of `MAX_MODEL_ROWS - 1`. Everything else about
the cap is unchanged: the refusal still happens at the append, and the cap still records its own
problem row exactly once, so a shortened list still says it was shortened.

**The statement names the number it enforces.** `full()`'s problem says
`More than ${MAX_MODEL_ROWS} rows; …`, which would refuse row 197 while claiming a limit of 200
(plan attack 4). It becomes `More than ${MAX_READ_ROWS} rows; <what> and after are not offered.`
— same shape, same "are not offered" wording every suite matches on, and true.

Three is the count of rows the host can add to one model, and it is a closed set:

| Row | Where | When |
|---|---|---|
| the save's refusal | `refusedSave` (`WorktreeHost.ts:208`) | a write the writer refused |
| the save's lock report | `leftLocked` (`WorktreeHost.ts:246`) | `mayStillBeLocked` |
| the added-step withholding statement | `withAdded` (`WorktreeHost.ts:1040`) | a recorded step does not fit |

The marker rows themselves are NOT in the reservation: `withAdded` already fits them into the
room the model leaves, and reserving for 32 of them would cost every repository 32 rows it can
see. The reservation covers only what the host adds unconditionally-on-event, which is why it is
a constant rather than a function of the record — the same function slices the record to the room
actually left, so sizing the reservation by the record would reserve twice (plan attack 6).

Nothing else the host publishes carries model rows: the port preview replaces each port with a
previewed one and preserves cardinality (`worktreePorts.ts:401-457`), and a migration offer is a
message of its own rather than a provisioning model (`WorktreeHost.ts:3637-3644`) — both checked
by the plan attack (1).

### D2: The reader spends it, so no composition order is load-bearing

The alternative was a host-side final budget that drops rows until the model fits. It cannot
work: `rowsOf` of a capped read is already `MAX_MODEL_ROWS`, so the host would have to drop
either a row that says what the create will do or a statement the spec requires it to make. With
the reservation, every host composition path is inside the bound by construction, and
`add-a-setup-step-for-this-create-only`'s `withAdded` needs no change at all.

### D3: `isKnownSave`'s admission stays at `MAX_MODEL_ROWS`

It bounds what comes BACK, and what comes back is a selection over a model of at most
`MAX_MODEL_ROWS` rows. Lowering it to `MAX_READ_ROWS` would refuse a legitimate full selection of
a model carrying marker rows.

## Architecture

```
read (providerKit budget)          host composition                webview
  entries/ports/setup/excluded  →  withAdded: marker rows       →  offer.model
  + problems                       + withholding statement          rowsOf ≤ 200
  ≤ MAX_READ_ROWS (196)            withSaveReports: refusal
  + its own cap problem  (197)     + lock report          (≤ 200)
```

## Interfaces

- `HOST_COMPOSED_ROWS` and `MAX_READ_ROWS` exported from
  `src/worktree/provisioning/providerKit.ts`.
- `full()` unchanged in signature; its threshold becomes `MAX_READ_ROWS`.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `full()` | a read stops 4 rows earlier than the suites expect | the provider suites pin counts against `MAX_MODEL_ROWS`; each is moved to the constant that names what it is really asserting, and a new witness proves the reserved room is still free after a capped read |
| the reservation constant | drifts from the rows the host actually adds | the host's three row sites are enumerated in D1, and the witness composes all three onto a capped read |
| `isKnownSave` | tightened by accident, refusing a valid full selection | its bound is deliberately left at `MAX_MODEL_ROWS` (D3), witnessed by the dependent change's existing full-selection save tests |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| No published provisioning model exceeds `MAX_MODEL_ROWS` rows | For every offer any host path issues, `rowsOf(model) ≤ MAX_MODEL_ROWS` | A capped read, a refused save that also left a lock, and a recorded added step compose 202 rows | Host test: capped read + `{ok:false, mayStillBeLocked:true}` save + a recorded step → `rowsOf` of the published offer ≤ `MAX_MODEL_ROWS`; and the same for one report alone | unresolved — until 1_1 and 2_1 land |
| The save outcome is never dropped to make room | A refusal the writer reported and a lock it reported both appear on the published model, whatever the read spent | The reservation is spent by the read and the reports are silently discarded | The same host test asserts both problem reasons are present on the capped-read offer | unresolved — until 2_1 lands |
| The reader's cap statement is never dropped | A read that hit the cap still carries exactly one "are not offered" problem after the host composes | The host's rows evict it | The same test asserts the reader's cap problem is still there beside the save reports | unresolved — until 2_1 lands |
| The reservation is really free | After a read that hit the cap, at least `HOST_COMPOSED_ROWS` slots remain under `MAX_MODEL_ROWS` | `full()` still spends to `MAX_MODEL_ROWS - 1` | providerKit test: fill past the cap, then assert `rowsOf(modelFromDraft(draft)) + HOST_COMPOSED_ROWS ≤ MAX_MODEL_ROWS` | unresolved — until 1_1 lands |
| A shortened list still says so | A capped read's problem set still contains its own statement | The threshold change skips the statement | Existing provider suites' "are not offered" assertions, unchanged | supported — `full()` records the problem on the same branch it refuses |
