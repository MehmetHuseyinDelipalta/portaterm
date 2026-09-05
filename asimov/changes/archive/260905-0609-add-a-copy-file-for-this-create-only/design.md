# Design: add a copy file for this create only

## Decisions

### D1: The extension picker returns a safely held in-repository file

`createWorktreeActions` owns `pickCopyFile(repoRoot)`. Activation creates one
`HeldRegularFilePool(64)` from prerequisite `bind-a-picked-copy-to-its-source-leaf` and disposes it on
extension teardown. The action opens `vscode.window.showOpenDialog` with one file, no folders, and
`defaultUri` at the main checkout.

After a choice, the action synchronously reserves one prerequisite lifecycle slot BEFORE any
filesystem admission work. It runs one bounded admission promise: prepare the resolved repository root,
obtain canonical inside path A from `authorizedPathInsideRoot(originalPickedPath, root)`, safely hold
the ORIGINAL picker pathname through that reservation, then obtain canonical inside path B from the
original pathname again. A and B must match. The action derives a nonempty POSIX repository path from B
against the prepared resolved root and returns both that path and B.

A five-second admission deadline races the whole promise, including root/candidate resolution,
no-follow open, and opened-handle stat. On timeout, cancellation, unsupported no-follow, pool
exhaustion, final symlink, outside/equal path, containment disagreement, or read failure, the action
abandons the reservation and returns `undefined` so the host can answer the live form. Any late holder
is disposed, and a never-settling admission keeps only its one pool slot charged. Contents are not read.

```ts
interface PickedCopyFile {
  readonly path: string;              // repository-relative POSIX display/destination
  readonly canonicalPath: string;     // resolved source path paired privately with the holder
  readonly file: HeldRegularFile;     // exact regular object safely opened after the picker returned
}
```

The unavoidable interval from VS Code returning a pathname until the safe hold is explicit: the host
can retain only the object it opens, not an object identity the picker API does not expose. The hold's
final component never follows; transient ancestor redirection entirely between resolved containment
observations remains the prerequisite D6 residual.

### D2: One opening record composes entry objects and private sidecars together

```ts
interface AddedCopyRecord {
  readonly path: string;
  readonly canonicalPath: string;
  readonly file: HeldRegularFile;
}

const addedCopyFiles = new Map<string, readonly AddedCopyRecord[]>();
```

The slot, sequence ordering, and retirement are the existing setup-step owners. The record is capped
at 32 and shares the extension-wide 64-handle pool. A holder that does not enter the record is disposed
immediately; `retireOpening` disposes every unclaimed holder. Claim transfer makes later holder
disposal a no-op, while mutation cleanup owns the claim.

`withAdded` becomes a compositor returning `{ model, heldFiles }`. For prior offers it strips added
copy entries by the offer's private `heldFiles` ids, never by display `source`; setup rows retain their
existing setup-specific owner. It appends each admitted record entry and maps that exact object to its canonical path and holder before `offers.issue`, which remints both through the prerequisite sidecar.

An added entry carries `addedForCreate: true` solely for webview rendering and the label `Added for
this create`; neither is read by host authorization or Save. It is always `mode: "copy"`, starts
selected, and warns `May contain secrets.`.

Composition emits the longest record prefix that neither duplicates nor possibly folds onto a base
entry/exclusion and fits the shared model capacity; one withholding problem names the remainder. The
record is never truncated, so switching back to a compatible sparse source restores it. Every initial,
switch, save, and ask issue site passes both model and sidecar.

### D3: Current provider intent wins over an ad-hoc duplicate

The current source's configured entries and exclusions are explicit repository policy. A picker result
whose identity already appears in either list, in the added record, or in a possible fold group is
refused and disposed; the offer is reissued unchanged. A later source switch that introduces such a
collision withholds that record item and the suffix after it, preserving prefix/ordinal tick identity
until a compatible source returns. While any existing record item is withheld by collision or capacity,
a new add is refused before opening the picker; an accepted add is therefore always visible selected in
its answering offer.

This fail-closed rule avoids two authorities for one destination and does not let a current-create
convenience silently override a deliberate exclusion. The user can select an existing configured or
suggested row, or switch sources, instead.

### D4: The ask shares source/save ordering and always releases the form

The webview posts only:

```ts
interface WorktreeCopyFileAskMessage {
  type: "worktreeCopyFileAsk";
  repoId: string;
  opening: number;
  switch: number;
}
```

`isKnownCopyFileAsk` applies `onlyKeys`. The ask uses the existing `provisionSwitch` slot shared by
setup, source switch, and Save. After the picker resolves, the host rechecks sequence, opening, and
surface before mutating. An outranked or gone ask disposes the returned holder and publishes nothing.
Every other admitted outcome—cancel, rejection, duplicate, exclusion, contender, record/model cap, or
accepted add—issues one fresh offer and sidecar, releasing the form.

### D5: The dialog uses explicit presentation origin and one form-wide gate

`ProvisionEntry.addedForCreate?: true` is set only by host composition and drives display/defaults; the
webview cannot submit it as authority. `pendingCopy` joins the existing form-wide gate, holding Create,
Save, repository selector, source switches, setup controls, and copy controls until a fresh offer
answers.

`addedCopyTicks[repoId]` is indexed by full record ordinal. Because composition exposes a prefix, an
unticked hidden suffix returns with its own state after switching back. A new item defaults selected.
Focus returns to `Add file to copy…` only if that button held focus when pressed and the user did not
move elsewhere while waiting.

The Save note becomes “Added files, setup steps and ports apply to this create only.”

### D6: Save excludes private sidecar rows; Create claims them transactionally

Save resolves the current internal offer and removes EVERY sidecar-backed entry from the model
handed to `divergenceOf`, regardless of whether its checkbox is selected; it also removes those ids
from the kept set. Display labels and `addedForCreate` are irrelevant. The record is recomposed after
the reread, so the same opening keeps its picked row and tick without becoming an exclusion.

Create first completes every synchronous admission check, including live opening/current offer, final
message shape, and launch admission. Before its first possible `await`, it redeems the current offer,
transactionally claims selected holders, and transfers them to a pending-submission owner. Ordered
Create-then-close delivery therefore retires only unselected record holders; it cannot evict or dispose
the claims needed after migration probing.

The async `runCreate` performs migration re-probe and then `await create(request)` inside `try/finally`.
A failed migration probe, one failed claim, action rejection, or normal completion disposes all claims
idempotently. Model rows remain model material; no failed/repeated claim downgrades. The mutation request
owns matching cleanup after dispatch.

The end-to-end witness performs Save first, proves the native config contains no added path, then
creates from the still-open form and proves the held file is copied. Create is never followed by Save
because successful Create disposes the dialog.

## Architecture

```mermaid
sequenceDiagram
  participant W as Webview
  participant H as Host
  participant V as Extension picker
  participant P as Held-file pool
  participant O as Offer store
  participant M as Mutation
  W->>H: copy ask without path
  H->>V: pickCopyFile(main checkout)
  V->>P: reserve one lifecycle slot
  V->>V: bounded canonical inside path A
  V->>P: hold original pathname with O_NOFOLLOW
  V->>V: canonical inside path B; require A = B
  V-->>H: relative path + holder
  H->>O: model + exact entry-object sidecar
  O-->>W: offer id + model only
  W->>H: Create with offer id + item ids
  H->>O: private redemption
  H->>H: synchronously claim into pending submission
  H->>H: dialog close retires only unselected holders
  H->>M: after async probes, dispatch materials
  M->>P: read exact held object; close claim
```

## Interfaces

- `ProvisionEntry.addedForCreate?: true` as presentation-only wire metadata.
- `WorktreeCopyFileAskMessage`, added to inbound unions and route lists.
- `PickedCopyFile` and `WorktreeActions.pickCopyFile(repoRoot)`.
- One extension-scoped `HeldRegularFilePool`, disposed with activation subscriptions.
- `withAdded` output `{ model, heldFiles: ReadonlyMap<ProvisionEntry, HeldProvisionSource> }`.
- Prerequisite `ProvisionOfferStore.issue(..., heldFiles)`, `redeem`, material claims, and strict apply.
- `WorktreeCreateDialogDeps.onCopyFileAsk({ repoId, switch })`.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| picker admission | resolution/open hangs or follows outside/symlink | reserve before I/O; five-second answer deadline; bracket original pathname; hold original leaf no-follow; late cleanup stays charged |
| unsupported Windows no-follow | metadata collision or final symlink redirects secret copy | pool refuses hold; unchanged offer answers |
| pool | repeated timed-out admissions or copies exhaust resources | one extension-scoped 64-slot lifecycle pool plus 32-record cap; unfinished operations retain charged slots |
| record | holder leaks after stale ask or retirement | post-await sequence check disposes loser; retirement owns unclaimed holders; pending submission owns claims |
| offer provenance | source string or reminted duplicate grants authority | exact entry-object sidecar translated to opaque id; private redemption only |
| duplicate/exclusion | ad-hoc row overrides repository policy | current source entries/exclusions/contenders win; holder disposed; later conflicts withhold prefix |
| reissue | private association disappears on switch/save | every issue site composes model and sidecar together; full host sequence test |
| multi-claim | partial claims leak before dispatch | transactional redemption rolls back all earlier claims on one failure |
| Save | unticked private row becomes a persisted exclusion | remove all sidecar rows and ids before divergence; selected/unticked Save-first witnesses |
| dialog | second input or Create runs before answer | one form-wide pending gate shared with setup and source/save controls |
| warning | secret statement disappears from explicit file row | every added row retains visible/accessibly described `May contain secrets.` pending separate icon change |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| No webview value becomes file authority | ask/create carry only repo/opening/switch and opaque current offer/item ids; holder comes from extension picker and private redemption | smuggled path/marker is accepted or model field constructs a held material | type/runtime message refusals, marker-like provider row test, and wire JSON assertion | supported |
| Only a safely held in-repository regular object enters the record | one pre-I/O reservation bounds admission; original pathname is held no-follow between matching canonical inside answers; timeout/failure abandons | outside, root, final symlink, unsupported platform, containment drift, timeout, or stale ask returns a live holder | real and injected picker matrix with charged-slot assertions | supported |
| Record and handle ownership remains bounded through lifecycle | ≤32 records per slot, ≤64 charged extension handles, every rejected/stale/retired/detached/teardown arm requests disposal | 33rd record or 65th charged handle is admitted; sibling/reopen sees holder; stale result is reusable after disposal | host/picker bound and lifecycle matrix plus charged-slot behavior, including a kernel-stalled close | supported |
| Private provenance survives every offer reissue | each initial/switch/save/ask issue remints exact entry-object sidecars; no host decision reads presentation fields | reissue shows row without sidecar or sidecar attaches another duplicate id | issue-site sequence test, duplicate provisional-id test, and source-string collision test | supported |
| Provider configuration and exclusion win | current base identity/exclusion/contender prevents admission; later collision withholds record prefix without truncation | explicit exclusion is overridden or safe suffix loses ticks permanently | add refusal and sparse→colliding→sparse switch/save tests | supported |
| Every admitted ask releases the form | picker admission races a five-second deadline; every live highest outcome then issues a fresh offer; only gone/outranked asks stay silent | never-settling resolve/open leaves gate held, cancel/reject/cap posts nothing, or late holder escapes | timed-out admission, late completion, host outcome table, and dialog gate release tests | supported |
| Save never persists an added row | all sidecar-backed entries and ids are removed before divergence, selected or not; record returns after reread | unticked row becomes exclude/drop or display/path controls Save | selected and unticked host tests plus Save-first assembly test | supported |
| Create copies only fully claimed holders | synchronous admission claims transactionally into pending owner before close can retire; async run and mutation dispose idempotently | close evicts needed holder, migration rejection leaks claim, partial claim dispatches, or failure degrades | Create→close→migration schedules, failure-at-each-index, repeated submit, and replacement assembly tests | supported |
| Dialog tick state belongs to full record ordinal | shown rows are a prefix and full tick vector survives all reissues | hidden unticked suffix returns selected or tick moves to provider row | sparse→dense/collision→sparse tests for switch and Save | supported |
| Initial pathname-to-open interval remains explicit | authority begins at the exact object safely opened after picker return; picker API supplies no earlier handle | docs claim the chooser's historical object is frozen | n/a — D1 names the interval and tests begin from the held object | supported |
