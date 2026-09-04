# Design: supplement provider answers with missing initialization suggestions

## Decisions

### D1: One detector, optionally composed onto a base model

`suggestProvisioning(deps, repoRoot, budget, base = emptyModel())` keeps the current fixed-name,
`lstat`-only detector. It builds suggestion rows in a fresh draft on the SAME read budget, then
returns the base model with admitted suggestion entries/setup and suggestion problems appended.
Every `readProvisioning` success branch passes its finished model as `base`; the no-provider branch
passes none. A model containing an `unreadable` problem is returned unchanged.

The detector still never reads an environment file or lockfile. Workspace manifests remain the only
files it opens, solely to enumerate workspace directories already declared by the repository.

### D2: Missing means no duplicate and no possible destination contender

For an environment candidate, the occupied set is `base.entries + base.excluded + suggestions
already admitted`. Exact normalized identity uses `identityOf`. A candidate is also suppressed when
`contendersOf([...occupied, candidate])` puts its id in a possible fold group. This deliberately
prefers omission over creating two rows that may map to one destination on APFS, NTFS, or Win32.
Because no admitted suggestion can introduce a new contender, `base.contenders` remains valid.

For setup, exact script equality suppresses a suggestion already present in `base.setup` or admitted
by another lockfile for the same manager. Different managers remain separate unchecked rows.

### D3: Provider authority and save semantics do not move

Configured rows stay in their original order and retain their default selection. Suggestions append
and start unchecked via the existing `suggestion` marker. Provider metadata, problems, ports,
excluded rows and contender groups survive byte-for-byte.

A selected suggested file still becomes `addCopy` through `divergenceOf`; when the chosen source is
not native, the writer records `extends` to that active provider exactly as it already does. Suggested
setup remains absent from divergence, so a lockfile suggestion returns unchecked on later forms until
configuration explicitly declares that command.

## Interfaces

- `suggestProvisioning(deps, repoRoot, budget, base?: ProvisionModel): Promise<ProvisionModel>`.
- No wire, dialog, host-action, or configuration schema change.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| environment detection | secret bytes are inspected | unchanged fixed names and `lstat` only; tests spy every dependency call |
| composition | suggestion duplicates or contends with a configured/excluded path | normalized identity plus `contendersOf` fail-closed suppression (D2) |
| setup | duplicate install command or implicit manager choice | exact command suppression; distinct managers remain separate and unchecked |
| provider switch | supplement from the old source leaks into the new one | supplement after each preferred read, against that read's finished model |
| save | unchecked suggestion becomes preference, or setup persists | existing `divergenceOf` suggestion branch unchanged (D3) |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| Secret values are never inspected | Environment and lockfile candidates use fixed-name `lstat`; only workspace manifests use `readFile` | `.env` or lockfile contents are opened, arbitrary names enumerated, or a symlink accepted | existing dependency-spy suite rerun with a nonempty base; assert no candidate path reaches `readFile`/`readdir` and symlink candidate absent | unresolved — until 1_1 lands |
| Configuration is never overridden | Base rows are unchanged and ordered first; suggestions append unchecked | a base row changes, a suggestion starts selected, or a duplicate path/command appears | pure detector tests over declared, excluded, fold-contending and setup-equal candidates; dialog existing suggestion-default tests | unresolved — until 1_1 / 2_1 land |
| Every provider answer receives only its own missing rows | Supplement runs after each finished preferred read | switching from Asimov to Orca keeps suggestions suppressed by Asimov declarations | readProvisioning integration test over two providers whose declarations differ, then preferred reread | unresolved — until 2_1 lands |
| Save retains positive-file-only semantics | Selected suggested file becomes native copy and setup never persists | supplemental setup gains standing consent, or unselected file becomes exclude | existing divergence and host-save tests plus later reread: configured file not suggested, setup suggested unchecked | unresolved — until 2_1 lands |
| The model row bound still holds | Suggestions spend the same ProviderBudget after the base read | a full provider model buys another suggestion budget | cap test with readable provider at `MAX_READ_ROWS`, present candidates, `rowsOf(result) ≤ MAX_READ_ROWS + 1` | unresolved — until 2_1 lands |
