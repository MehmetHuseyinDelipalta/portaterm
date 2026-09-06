// src/webview/worktree/createDialog/bringContention.ts — Which provisioning
// rows collide, and which of them yield.
//
// Extracted from `WorktreeCreateDialog.ts` by change `decompose-create-dialog`
// (design.md D1, task 1_1). These were already module-level pure functions, so
// the cut is a move: no body changes, only the import list.
//
// One comment moved with a correction. The doc block opening "Each grouped row
// against the spellings it may collide with" sat above `yieldsTo`'s own doc
// block in the original, describing neither — it belongs to
// `contenderPartners`, which had none, and is attached to it here.
//
// The suite beside this file declares NO environment pragma, so it runs under
// node: a `document` reaching in here throws rather than passing quietly under
// the dialog's jsdom (OBL-3).

import type { WorktreeProvisionOffer } from "../worktreeViewTypes";

/**
 * Rows the apply will refuse, against the spelling that takes their place.
 *
 * Decided by the repository declarations still SELECTED, which is the predicate
 * the apply applies to the entries it is submitted (design.md D3c): exactly one
 * makes that one favoured and the rest yield, none leaves nothing claiming
 * priority, and more than one is refused entire — that last case has no single
 * counterpart to name, so `refusedEntire` below carries it instead.
 *
 * Reading the SELECTION rather than the offer is the whole point. A winner
 * computed once against the full offer goes stale the moment a row is unticked,
 * which is how this statement diverged from the apply at rounds 3, 5 and 7.
 */
export function yieldsTo(
  model: WorktreeProvisionOffer["model"],
  selected: ReadonlySet<string>,
): Map<string, { id: string; path: string }> {
  const pathOf = new Map(model.entries.map((e) => [e.id, e.path] as const));
  const losers = new Map<string, { id: string; path: string }>();
  for (const group of model.contenders) {
    const claiming = group.natives.filter((member) => selected.has(member));
    const id = claiming.length === 1 ? claiming[0] : undefined;
    const path = id === undefined ? undefined : pathOf.get(id);
    if (id === undefined || path === undefined) {
      continue;
    }
    for (const member of group.members) {
      if (member !== id) {
        losers.set(member, { id, path });
      }
    }
  }
  return losers;
}

/**
 * Each grouped row against the spellings it may collide with, by id.
 *
 * The group travels as ids so the wire carries no second copy of a path
 * (design D3); the paths are read back from the entries the ids name, which
 * keeps § 4.3 true — a row still displays the spelling its own file wrote.
 */
export function contenderPartners(model: WorktreeProvisionOffer["model"]): Map<string, string[]> {
  const pathOf = new Map(model.entries.map((e) => [e.id, e.path] as const));
  const partners = new Map<string, string[]>();
  for (const group of model.contenders) {
    for (const id of group.members) {
      const named = group.members
        .filter((other) => other !== id)
        .flatMap((other) => {
          const path = pathOf.get(other);
          return path === undefined ? [] : [path];
        });
      if (named.length > 0) {
        partners.set(id, named);
      }
    }
  }
  return partners;
}

/**
 * Which contender group each entry belongs to, and which of them are the
 * repository's own declarations.
 *
 * The notes are rendered against the group rather than against the declaration
 * the OFFERED selection favours, for the same reason both of them are shown by
 * a count: with more than one repository declaration nothing is favoured at the
 * offered selection, and a note that was never rendered cannot appear when the
 * user unselects one and makes another the favoured declaration. WHICH
 * declarations a note names is settled at selection time, not here.
 */
export function groupIndex(model: WorktreeProvisionOffer["model"]): Map<string, { group: number; native: boolean }> {
  const of = new Map<string, { group: number; native: boolean }>();
  model.contenders.forEach((contest, group) => {
    const natives = new Set(contest.natives);
    for (const member of contest.members) {
      of.set(member, { group, native: natives.has(member) });
    }
  });
  return of;
}

/** `A and B are both selected` / `A, B and C are all selected`. */
export function bothOrAll(paths: readonly string[]): string {
  return paths.length === 2
    ? `${paths[0]} and ${paths[1]} are both selected`
    : `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]} are all selected`;
}

/**
 * The repository's own declarations of each group that the selection still holds.
 *
 * The other half of D3c's predicate, and the half with no counterpart to name:
 * nothing decides between two of the repository's own declarations, so no
 * single row can be unticked to rescue the group — the user has to leave one of
 * them selected, which is why every member says so rather than one of them.
 *
 * Selected is the ORDINARY default for such a group, unlike a yielder. Unticking
 * is what makes a yielder's group succeed, so unticked is the state its note
 * describes; this group has no succeeding state to default to, and offering it
 * unselected would make every row's note false at the very selection it was
 * offered at — and would read as "nothing claims priority", which is the state
 * the apply APPLIES.
 */
export function claimingPerGroup(
  model: WorktreeProvisionOffer["model"],
  selected: ReadonlySet<string>,
): readonly (readonly string[])[] {
  return model.contenders.map((contest) => contest.natives.filter((id) => selected.has(id)));
}

/** The members no selection of theirs can bring over, for the selection held. */
export function refusedEntire(
  model: WorktreeProvisionOffer["model"],
  selected: ReadonlySet<string>,
): ReadonlySet<string> {
  const refused = new Set<string>();
  const claiming = claimingPerGroup(model, selected);
  model.contenders.forEach((contest, group) => {
    if ((claiming[group]?.length ?? 0) > 1) {
      for (const member of contest.members) {
        refused.add(member);
      }
    }
  });
  return refused;
}
