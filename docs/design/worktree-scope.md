# Terminal Ownership and Worktree Navigation

> **Ref**: docs/DESIGN.md § 8.7 — stable terminal ownership and per-surface navigation
> **Consumer**: `asimov-plan` reads this to derive terminal/worktree navigation changes.

This document owns the relationship between terminals, linked worktrees, tab presentation, and
navigation. Worktree row anatomy lives in [worktree-panel-ui.md](worktree-panel-ui.md); activity
evidence lives in [worktree-agent-presence.md](worktree-agent-presence.md).

## 1. Model

```ts
type TerminalOwner =
  | { kind: "main" }
  | { kind: "linked"; id: string };
```

Main is one global owner for the surface. It is not one owner per repository and therefore never
names a repository-specific main row. A linked terminal stores its canonical stable `worktreeId`.
An ownerless legacy terminal decodes as main.

Ownership is assigned when a terminal is created or restored:

- an ordinary main terminal has no `worktreeId`;
- a terminal created for a linked worktree stores that linked id;
- a split inherits its source pane's owner;
- a snapshot persists the owner;
- changing shell cwd never changes the owner.

Presence may report cwd, agent identity, activity, or waiting evidence, but presence never decides
terminal ownership. This separation prevents a shell `cd`, a delayed scan, or missing evidence from
moving tabs between owners.

## 2. Per-surface navigation state

Each sidebar, panel, and editor surface owns one navigation state:

```ts
interface TerminalNavigationState {
  activeOwner: TerminalOwner;
  activeTabId: string | null;
  activePaneByTab: Record<string, string>;
}
```

Owner, tab, and pane are committed atomically. A valid active tab belongs to `activeOwner`; its
active pane is a live leaf of that tab. An owner may intentionally have no tab, represented by a
null active tab while the owner remains unchanged.

Navigation is per surface. Focusing a terminal in one surface does not move another surface's
owner, tab, pane, or checkpoint. The host routes requests to the surface that owns the target pane;
it does not broadcast navigation state.

### 2.1 Intent results

| Intent | Result |
|---|---|
| Activate worktree row | Select main or the linked owner, retaining a valid owner tab/pane or choosing one deterministically |
| Click terminal tab | Derive its owner and commit that tab plus its retained live pane |
| Focus pane or agent row | Derive owner and containing tab from the exact pane |
| Create terminal | Register owner and topology first, then commit the new tab and pane |
| Complete split | Attach to the captured source tab; activate only when that source tab remains active |
| Close pane/tab | Normalize within the same owner; retain owner-empty when no owner tab remains |
| Restore | Build the catalog first, then apply checkpoint, live hint, legacy migration, or main fallback |
| Reconcile owners | Reassign terminals whose linked owner left a complete tree to main, then normalize once |

One accepted intent produces one ordered effect batch. A structural no-op produces none. An effect
that raises another intent queues it until the current batch is complete, and delayed focus/fit
work is generation-guarded.

## 3. Projection

The tab bar, linked frame, compact indicator, worktree mark, waiting badge, and empty region are all
projections of committed navigation plus terminal facts. None stores a second owner or writes
navigation while rendering.

### 3.1 Tab membership

Membership is exact stable-owner equality:

| Active owner | Presented tabs |
|---|---|
| Main | Tabs whose panes have no `worktreeId` |
| Linked `A` | Tabs whose panes have `worktreeId === A` |

Presence attribution is not an input. Split children inherit one owner, so every normal split tab
has one owner. Collapsed split topology is read through its surviving live leaf rather than through
a removed root session.

### 3.2 Linked treatment and worktree marks

A linked active owner renders:

- the linked frame around the terminal surface;
- a compact indicator naming the linked worktree;
- exactly one mark on the matching linked worktree row.

Main renders none of those. Activating any repository's main worktree row requests the same global
main owner and leaves every repository-specific row unmarked. Roving keyboard focus, expansion,
search, menus, and rail visibility remain independent of the owner mark.

### 3.3 Hidden waiting tabs

While a linked owner is active, its indicator counts hidden tabs containing a non-exited waiting
pane. Waiting is the union of local terminal status and presence waiting evidence. Presence is only
decoration here: it can move the count, never membership.

The unit is the tab. A hidden split with two waiting panes counts once. Zero renders no badge.
Main hides no main-owned tabs behind a linked indicator, so main renders no hidden-waiting mark.

### 3.4 Owner-empty region

An active owner with no terminal presents a normal empty region that:

- names Main or the linked worktree;
- offers a new terminal in that owner;
- offers agent launch only when available;
- says another worktree may be chosen;
- never shows an out-of-owner pane or changes owner automatically.

The terminal container stays mounted while hidden so xterm viewport and process state survive.
An arriving terminal removes the empty region through the next projection render.

## 4. Creation, close, and split rules

New Terminal uses the current active owner. Closing the last owner tab retains that owner and asks
for a replacement in it. The replacement becomes active only after its terminal fact and topology
exist.

A split request captures request id, source tab, source pane, and direction. The response attaches
to that captured source, not whichever tab later became active. The host never destroys a child while
its `splitPaneCreated` post is in flight: resolved-false delivery rolls back, while resolved-true
delivery waits for explicit attachment or rejection. The webview request deadline rejects instead of
silently forgetting the request, and surface disposal releases unresolved pending children. Attachment
is acknowledged only after replayable navigation effects complete. Persistent effect failure gets one
scheduled retry, then detaches the provisional child and sends correlated rejection.

## 5. Restore and reconciliation

Each surface persists a versioned navigation checkpoint. Restore precedence is:

1. structurally valid V1 checkpoint;
2. validated live host hint during an in-memory bootstrap;
3. one-shot legacy linked scope during an in-memory bootstrap;
4. deterministic main fallback.

A cold bootstrap ignores the live hint and legacy field. An explicit checkpoint owner-empty state
is preserved. Snapshot replay order never manufactures activity.

A null or absent worktree tree proves nothing about linked-owner removal. Only a complete tree
missing a linked id reassigns affected terminal facts to main. Reconciliation changes owner facts
and navigation in one controller transaction, after which every projection redraws from the same
committed result.

## 6. Layout and rail independence

Owner navigation behaves identically in sidebar, panel, and editor layouts. The worktree rail may
be beside, above, below, open, or collapsed; choosing an owner does not change that layout state.
Only the rail's own controls change its visibility.

## 7. Verification cases

- Main shows only main-owned tabs and marks no worktree row in a multi-root workspace.
- Linked owner A shows only A's tabs, frame, indicator, and row mark.
- Shell `cd` changes presence placement but not terminal owner or tab membership.
- Tab click, pane focus, creation, split completion, close, restore, and reconciliation each commit
  owner, tab, and pane together.
- New Terminal and last-tab replacement retain the active owner.
- Hidden waiting counts change without moving membership.
- Owner-empty state offers owner-specific actions and never changes owner automatically.
- Two surfaces retain independent navigation checkpoints and projections.
- A missing tree response does not remove a linked owner; a complete tree may reconcile it.
