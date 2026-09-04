# Design: supplement provider answers with missing initialization suggestions

## Decisions

### D1: One detector, optionally composed onto a complete base model

`suggestProvisioning(deps, repoRoot, budget, base = emptyModel())` keeps the fixed-name detector. It
builds suggestion rows in a fresh draft on the SAME budget, then returns the base with admitted
suggestion entries/setup/problems appended. Every `readProvisioning` success branch passes its
finished model as `base`; the no-provider branch passes none.

Suggestion manifests use a separate required dependency,
`readManifest(path): Promise<string>`, supplied by a bounded `openRegularFile(..., { noFollow: true })`
reader. Reusing provider `readFile` follows symlinks by design; an in-repository
`package.json -> .env` therefore read secret bytes during suggestion discovery (plan attack F1).
Environment and lockfile candidates themselves remain `lstat`-only. Workspace enumeration remains
bounded by the existing scan budget.

### D2: Missing means no duplicate and no possible destination contender

For an environment candidate, the occupied set is `base.entries + base.excluded + suggestions
already admitted`. Exact normalized identity uses `identityOf`. A candidate is also suppressed when
`contendersOf([...occupied, candidate])` puts ITS DISJOINT probe id in a possible-fold group. The id
is minted by advancing `budget.nextId()` until it is absent from every selectable base id; pre-offer
models are not guaranteed collision-free, so raw membership under the first id could suppress an
unrelated candidate (plan attack F2). Because no admitted suggestion can introduce a new contender,
`base.contenders` remains valid.

Setup duplicate identity is exact script text. Configured duplicate steps are intentionally
meaningful and untouched; only the static suggestion is suppressed when the exact command is already
present. Whitespace and aliases are not shell-program identity and are never normalized.

### D3: Capacity is synchronized to the finished model, without refunding omitted declarations

The provider budget records historical appends; native merge can discard a charged inherited row.
Before supplementing a complete base, the detector:

1. returns the base unchanged when the read already hit its cap (`budget.capped`) — configured
   material was omitted and suggestions never spend its place;
2. returns unchanged when `rowsOf(base) > MAX_READ_ROWS + 1`;
3. otherwise sets `budget.rows = rowsOf(base)` while preserving `scanned`, `nextId`, and `capped`,
   then admits suggestions through `addEntry`/`addSetup`.

This refunds only charged rows that survived no final model while no configured row was omitted. The
optional-base API enforces the coupling itself, so a full base plus `newBudget()` cannot exceed the
bound in a test or future caller.

### D4: Completeness is an adapter answer, never inferred from problem wording

`AdapterRead` gains required `suggestible: boolean`. Each adapter returns true only after a complete
parse/read with no provider problem; open refusal, malformed/partial parse, invalid shape and damaged
keys return false. Native assembly returns suggestible only when native and any inherited answer are
suggestible, `extends` resolves, and assembly raised no problem. A valid empty source is true.

`readProvisioning` supplements only a suggestible finished answer. This deliberately fails closed:
a partial answer may have attempted to declare exactly the file or setup command the detector would
otherwise add, and a reason string cannot distinguish that from a row-level warning (plan attack F4).

### D5: Provider authority and save semantics do not move

Configured rows stay byte-identical and ordered first. Suggestions append and start unchecked via the
existing `suggestion` marker. Provider metadata, ports, excluded rows, contender groups and original
problems survive by identity and order; a fully populated fixture witnesses every field.

A selected suggested file still becomes `addCopy` through `divergenceOf`; a non-native active source
still becomes `extends`. Suggested setup remains absent from divergence, so a lockfile suggestion
returns unchecked on later forms until configuration explicitly declares that exact command.
Source switching rereads and supplements the newly chosen source from scratch; no prior offer rows
are carried.

The existing “May contain secrets” warning remains present and unchanged. Moving it from text to an
icon hint is a separate webview invariant and is not folded into this provisioning-composition change.

## Interfaces

- `SuggestDeps.readManifest(path): Promise<string>` in addition to fixed-name `lstat`, bounded
  `readdir`, and `realpath`.
- `suggestProvisioning(deps, repoRoot, budget, base?: ProvisionModel): Promise<ProvisionModel>`.
- `AdapterRead.suggestible: boolean`, required for every provider.
- No wire, dialog, host-action, or configuration schema change.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| workspace manifests | symlink reads `.env`/lockfile bytes | bounded no-follow `readManifest` and symlink tests (D1) |
| environment candidates | secret bytes are inspected | unchanged fixed names and `lstat` only |
| composition | suggestion duplicates/contends or base field changes | disjoint probe id, normalized identity, `contendersOf`, full-base identity fixture (D2/D5) |
| row budget | historical spend suppresses safe rows or fresh budget overfills base | cap fail-closed plus `rowsOf(base)` synchronization inside API (D3) |
| incomplete provider | reason-code guess appends over attempted declarations | required adapter `suggestible` propagated through assembly (D4) |
| setup | implicit normalization/manager choice | exact script equality; distinct managers remain separate unchecked rows |
| save | unchecked suggestion becomes preference, or setup persists | existing `divergenceOf` branch unchanged; non-native save/reread witness (D5) |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| Secret values are never inspected | candidates use fixed-name `lstat`; workspace manifests use bounded no-follow `readManifest` only | manifest symlink points to `.env`/lockfile, candidate bytes opened, or arbitrary names enumerated | production dependency test + detector spies; in-root manifest symlink refused; candidate paths never reach either reader | unresolved — until 1_1 lands |
| Configuration is never overridden | complete base fields/objects/order unchanged; suggestions append unchecked; no exact/fold contender or exact setup command | base changes, ID collision suppresses wrong candidate, duplicate row appears | fully populated base fixture; ID-collision fixture; declared/excluded/fold/setup cases | unresolved — until 1_1 lands |
| Incomplete answers receive no suggestions | required `suggestible` is false for open/parse/shape/extends/assembly failures | malformed partial model gains `.env` it attempted to declare | adapter table tests plus native missing-extends and damaged-inline integration cases | unresolved — until 2_1 lands |
| Every complete provider answer receives only its own missing rows | supplement runs after each finished preferred read | switch keeps prior source rows or misses freed merge capacity | two-provider switch test; native duplicate-merge test proves final-row capacity; cap-hit test proves no refund after omission | unresolved — until 2_1 lands |
| Save retains positive-file-only semantics | selected suggestion becomes addCopy/extends; setup never persists | setup saved, unselected file excluded, or later reread loses source | divergence tests plus non-native host save/reread: file configured, setup suggested unchecked | unresolved — until 2_1 lands |
| Final model stays within read allowance | API synchronizes budget to base and every append uses kit gates | full base with fresh budget returns over cap | direct optional-base test and absent/framework/native/merge-heavy integration branches | unresolved — until 1_1 / 2_1 land |
| Secret warning is preserved | every environment suggestion still carries `May contain secrets.` | composition strips warning | detector and host offer tests assert exact suggestion field | supported — no renderer change in scope |
