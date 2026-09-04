# Design: bind a picked copy to its source leaf

## Decisions

### D1: One bounded slot spans admission, exact handle, copy, and delayed closure

`src/utils/heldRegularFile.ts` defines a pool with 64 slots. A slot is reserved synchronously before
any post-picker filesystem operation and remains charged through one of these states: pending
containment/hold admission, live holder, claimed source, active copy, or source/destination closure
that the kernel has not completed. No 65th operation starts.

```ts
interface HeldFileReservation {
  hold(path: string): Promise<HeldRegularFile | undefined>;
  abandon(): void;
}
interface HeldRegularFile {
  claim(): ClaimedRegularFile | undefined;
  dispose(): void;
}
interface ClaimedRegularFile {
  acquireSource(): HeldFileSource | undefined;
  dispose(): void;
}
interface HeldFileSource {
  readonly stream: NodeJS.ReadableStream;
  readonly mode: number;
  readonly size: number;
  finishWhen(actualPipeline: Promise<unknown>): void;
  dispose(error?: Error): void;
}
```

`reserve` fails when all slots are charged. `reservation.hold(originalPath)` is one-shot and available
only with nonzero `O_NOFOLLOW`; it uses `openRegularFile(..., { noFollow: true })`, captures mode/size
from the opened regular handle during admission, and never treats identity metadata as later
authority. `abandon` marks a timed-out admission: late holder success is disposed rather than returned,
and the slot releases only when that work and any handle closure actually settle. A permanently hung
filesystem operation retains one slot, bounding repeated attempts.

`claim` and `acquireSource` are synchronous and one-shot. Source acquisition performs no filesystem
await: it transfers the already-proven handle to `createReadStream({ start: 0, autoClose: true })`.
The stream owns the descriptor. `copyHeldFile` registers its unraced pipeline promise through
`finishWhen`; the slot releases only after that pipeline's source and destination teardown settles.
Its caller may race the pipeline against the existing deadline, destroy both streams, report failure,
and leave the still-closing operation charged. A pre-copy refusal destroys the source and releases
when its close event lands.

No `autoClose: false` stream or direct `FileHandle.read/write` exists. Rename, replacement, unlink,
ReFS identifier collision, and case-distinct siblings cannot retarget the held descriptor. In-place
writes remain visible. Platforms without safe no-follow open return no holder.

### D2: Offer reminting carries an additive private object-keyed sidecar

`ProvisionOfferStore.issue` accepts an optional map from exact pre-remint `ProvisionEntry` object to:

```ts
interface HeldProvisionSource {
  readonly canonicalPath: string;
  readonly file: HeldRegularFile;
}
```

Object identity, not provisional id/path/source, lets duplicate provisional ids remint safely. A new
scoped `redeem(key, offerId)` returns the internal offer with its fresh item-id-to-source sidecar.
Existing `lookup` remains model-only, so the sidecar wave breaks no current caller. Wire publication
continues constructing only `{ offerId, model }`; canonical paths and handles never cross
`postMessage`. Offer eviction does not close sources because the per-opening record owns them across
reissues.

### D3: Strict production material retains provenance to the lowest copy door

```ts
export type ProvisionMaterial =
  | { readonly origin: "model"; readonly entry: ProvisionEntry }
  | {
      readonly origin: "held-file";
      readonly entry: ProvisionEntry & { readonly mode: "copy" };
      readonly canonicalPath: string;
      readonly file: ClaimedRegularFile;
    };
```

`applyProvisionMaterials(materials, ...)` is production's strict API after Task 4. The union remains
intact through `applyEntry` and `applyExclusiveEntry`; a held arm reaches only required
`copyHeldFile(source, ...)`, never source-path `copyFileNoFollow`. The existing
`applyProvisioning(entries, ...)` stays an explicitly model-only compatibility wrapper and cannot
accept held material. Production host, mutation service, and extension switch to the strict API in
one task.

Contest, result, report, and manifest calculations project each material's original entry reference,
so order and identity stay unchanged. Transactional claim helpers either return all selected
materials or dispose every earlier claim and return failure; no optional capability can downgrade.

### D4: Acquire the auto-closing source before any destination effect and dispose it at the apply door

For held material, apply first validates copy mode, contest/budget state, live checkout roots, and
canonical binding:

```ts
path.join(roots.source.prepared.resolved, entry.path) === material.canonicalPath
```

using the prepared root's platform path semantics. The picker derives `entry.path` from that same
resolved root, so macOS aliases such as `/var` versus `/private/var` agree without reopening the
source path.

Then synchronous `acquireSource` must return the auto-closing stream before `ensureParents`, `mkdir`, or any
destination open. The entire held branch owns that source in an outer `try/finally`; every exit,
including parent refusal/throw before `copyHeldFile`, destroys/releases it. `copyHeldFile` receives the
already-acquired source, opens only the exclusive destination, registers the actual pipeline through
`finishWhen`, and races its caller-visible result against the existing deadline. On timeout it destroys
both streams and returns failure without forgetting the charged slot; actual teardown later releases
it. Partial-output accounting and mode restoration match ordinary copy.

`applyProvisionMaterials` disposes all claims in its own outer `finally`; the mutation service repeats
idempotent disposal. Ordinary model material keeps current source-path open, symlink/directory walk,
Windows degradation, and `copyFileNoFollow` unchanged.

### D5: A pending submission owns claims across immediate dialog retirement

The panel posts Create and immediately closes; ordered delivery lets the host process Create first, but
any host `await` allows the close message to retire the opening and evict its offer. Therefore the host
must finish synchronous shape/live-offer/launch admission, redeem the current offer, and transactionally
claim selected holders before the first await in the admitted Create branch.

Claims move immediately into a `pendingProvisionCreate` owner keyed by the request execution, not the
opening record. `retireOpening` disposes unselected holders but never claims transferred to this owner.
The async `runCreate` then performs migration re-probe and all later checks inside `try/finally`; any
rejection closes pending claims, and `await create(request)` transfers them through mutation while the
same finally remains idempotent defense in depth. A repeated/late submit cannot pass live-opening and
current-offer admission.

The mutation service uses `await coordinator.run(...)` inside its own `try/finally`; returning an
unawaited promise would close claims too early and is a required negative test. Missing apply binding,
Git failure, root-authorization failure, apply rejection, and teardown all request claim disposal.
Extension teardown disposes the pool; acquired streams are destroyed and idle handles receive close
requests. Kernel-stalled admission or copy teardown remains charged under the fixed cap per D1.

### D6: The dependent picker owns safe admission and positive private association

The picker uses the original selected pathname for `hold`, never the canonical target. The sequence is:

1. prepare the resolved repository root and obtain canonical inside path A;
2. call `pool.hold(originalPickedPath)`, so `O_NOFOLLOW` applies to the picker leaf itself;
3. obtain canonical inside path B from the original pathname again;
4. require A equals B, derive the POSIX relative entry path from B against the prepared resolved root,
   and store `{ entryPath, canonicalPath: B, file }`.

A final symlink therefore fails at hold even if `realpath` says its target is inside. Persistent
containment drift disposes the holder. Transient ancestor redirection entirely between observations
remains Node's existing no-`openat` residual; no final-leaf following is admitted.

The parent must compose exact entry-object sidecars on every issue, remove every sidecar-backed entry
from Save divergence regardless of tick, claim synchronously into pending-submission ownership before the first host await, roll back partial
claims, and dispose all untransferred holders on opening/extension lifecycle exits.

## Architecture

```mermaid
sequenceDiagram
  participant P as Picker owner
  participant O as Offer store
  participant H as Host
  participant M as Mutation
  participant A as Apply
  participant F as Filesystem
  P->>P: reserve one of 64 admission/copy slots
  P->>F: hold original path with O_NOFOLLOW
  F-->>P: exact regular handle
  P->>O: entry object → canonical path + holder
  O-->>H: private reminted id sidecar
  H->>H: finish migration/launch gates; claim transactionally
  H->>M: strict ProvisionMaterial[]
  M->>A: await strict apply
  A->>F: acquire auto-closing source stream
  alt acquired
    A->>F: create parents/output; cancellable pipeline
  else unavailable
    A-->>M: failed/refused; no destination effect
  end
  A->>F: destroy/release source in every exit
```

## Interfaces

- `HeldRegularFilePool`, `HeldFileReservation`, `HeldRegularFile`, `ClaimedRegularFile`, `HeldFileSource`, and
  `createHeldRegularFilePool` in `src/utils/heldRegularFile.ts`.
- `HeldProvisionSource`; additive offer `issue(..., sidecar?)` and `redeem`; existing `lookup` retained.
- `ProvisionMaterial`, entry projection, transactional claims, and idempotent disposal in
  `src/worktree/provisioning/provisionMaterial.ts`.
- Strict `applyProvisionMaterials`; model-only compatibility `applyProvisioning`.
- `ApplyFsDeps.copyHeldFile(source, destination, mode, signal?, limit?)`; ordinary
  `copyFileNoFollow` unchanged.
- Task 4 changes production create/apply requests to `readonly ProvisionMaterial[]` together.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| unsupported platform | final symlink race relies on non-unique metadata | no held capability without nonzero `O_NOFOLLOW` |
| kernel-stalled I/O | admission or pipeline teardown ignores cancellation | one slot spans pending admission, source and destination teardown; timeout returns but slot stays charged |
| pre-copy refusal | source acquired then parent creation fails | held branch outer finally destroys source around ensureParents and copy |
| canonical alias | `/var` holder mismatches `/private/var` source root | sidecar stores canonical path; compare against prepared resolved root plus relative path |
| offer remint | duplicate provisional ids attach wrong source | exact entry-object input sidecar; fresh-id output sidecar; additive redeem |
| provenance | held capability drops to model copy | strict required union and separate production/copy APIs |
| immediate dialog close | opening retirement disposes holders before migration can claim, or transferred claims leak | synchronously redeem/claim into pending submission before first await; async run owns finally |
| mutation promise | finally runs before queue settles | explicitly await coordinator result before claim disposal |
| Save | unticked private row becomes exclusion | remove all sidecar-backed entries from divergence model, independent of selection |
| model behavior | stronger source opening changes Windows/provider rows | ordinary branch and binding untouched |
| inventory | new module breaks closed list | task updates `src/worktree/provisioning/readOnly.test.ts` |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| One holder preserves the exact regular object safely opened | original picker path is opened with supported `O_NOFOLLOW`; authority is the live handle, not metadata | final symlink follows, path reopens, or ReFS collision redirects bytes | unsupported/final-symlink refusal and replacement/unlink/same-id tests read only held handle | supported |
| Private provenance survives remint without presentation inference | exact entry-object sidecar maps canonical path+holder to fresh item id and stays internal | duplicate provisional id, marker source, or same path attaches another holder | offer-store object identity and model-only wire tests | supported |
| Held material cannot degrade in production | strict union reaches separate held-copy API; model wrapper cannot accept material | production projects before dispatch or held branch calls source-path copy | host→mutation→strict-apply recording and exhaustive dispatch tests | supported |
| No destination effect precedes a usable source | auto-closing source is acquired before parents/output and destroyed by a surrounding finally | acquisition fails or parent throws yet mkdir/open occurs or source leaks | operation-order tests at acquisition, parent, copy, abort, and disposal boundaries | supported |
| Model material retains existing behavior | ordinary path opening, Windows degradation, walk, contests, reports, and manifests are unchanged | model reaches pool/held copy or outcome/order changes | existing suites plus mixed-material and Windows ordinary witness | supported |
| Pending admission and held-copy resources stay globally bounded | one of 64 slots remains charged from pre-I/O reservation through late source/destination teardown; timeout never frees an unfinished slot | 65th operation starts, abandoned admission returns a holder, or stalled copy slot is forgotten/reused | concurrent admission cap, never-settling hold/pipeline, pre-copy throw, teardown, and double-dispose tests | supported |
| In-place edits remain visible while replacement cannot redirect | stream starts at offset zero on held object; same-object writes may change bytes; pathname changes cannot retarget | bytes snapshot or source reopen | rewrite, replace, unlink, and second-open substitution tests | supported |
| Parent positive association and cleanup are explicit dependencies | D6 requires original-path hold, canonical sidecar, all-row Save filtering, synchronous pending-submission claims, rollback, and lifecycle disposal | parent canonicalizes before hold, filters selected only, or awaits before claim ownership | dependent artifacts and their plan attack own each listed schedule | supported |
| Kernel-stalled admission or copy teardown may retain a slot indefinitely | Node cannot cancel every pending filesystem operation; timeout abandons/destroys and returns while the lifecycle slot remains charged | design claims synchronous closure or frees/reuses the slot before all late work settles | n/a — bounded 64-slot fail-closed residual; no portable Node cancellation primitive exists | supported |
| Only transient ancestor redirection remains residual | original final leaf gets `O_NOFOLLOW`; canonical checks bracket hold; no atomic ancestor traversal is claimed | final symlink accepted or stable alias falsely refused | final-symlink and macOS alias tests; D6 names only ancestor interval | supported |
