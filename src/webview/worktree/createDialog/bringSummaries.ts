// src/webview/worktree/createDialog/bringSummaries.ts — What a provisioning
// offer says about itself: the flat row list the section renders, what carries
// across a reminted offer, and the sentences that summarise both.
//
// Extracted from `WorktreeCreateDialog.ts` by change `decompose-create-dialog`
// (design.md D1, task 1_2). Already module-level and pure, so the cut is a
// move: no body changes, only the import list.
//
// `rowDescriptors` and `saveSummary` stay module-private — D1a's enumeration
// found both called only from inside this cluster, so exporting them would
// widen the surface for nothing.
//
// The suite beside this file declares NO environment pragma, so it runs under
// node and a `document` reaching in here throws rather than passing quietly
// under the dialog's jsdom (OBL-3).

import { SETUP_STEP_ADDED_SOURCE } from "../../../types/messages";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { contenderPartners, groupIndex, refusedEntire, yieldsTo } from "./bringContention";

/**
 * One offered item, flattened out of the model.
 *
 * `verb` and `subject` are separate because only the subject comes from the
 * provider file: it is untrusted text set with `textContent`, and it is the
 * half a row is identified by. `checked` is the row's initial state, not a
 * value anything reads yet — WT-012.2 is where a checkbox first decides
 * anything.
 */
export interface BringRow {
  id: string;
  verb: string;
  subject: string;
  source: string;
  checked: boolean;
  /** A setup step the user typed into this form: the host marked it, and the form may edit or remove it. */
  added?: boolean;
  /** Linked rows only: writing through the link changes the main checkout. */
  warn?: string;
  /**
   * Removed by the repository's own `exclude`: drawn, never offered.
   *
   * Shown rather than omitted because the two are different statements — a path
   * that is simply absent looks like something the host failed to find, and a
   * user comparing the section against the file it came from would go looking
   * for the difference. It carries no checkbox, so there is no state in which
   * it can be submitted.
   */
  excluded?: boolean;
  /**
   * Named partners this row may turn out to share a destination with.
   *
   * Advisory about WHICH rows may share a destination — the worktree does not
   * exist while this is drawn, so nothing here can be proven (design D2).
   * Whether this row will be applied is `yields` below, not this.
   */
  contender?: readonly string[];
  /**
   * This row loses its destination to the repository's own declaration.
   *
   * The apply refuses a held member on EVERY volume — a destination that reads
   * absent after the favoured member claimed cannot be told from that member's
   * material having been removed — so leaving the row checked promised the user
   * something that would be refused, and counted it into "N copied" first
   * (`award-a-contested-destination-or-refuse-it/.reviews/round-3.md` F007).
   *
   * Offered unchecked rather than withheld: the user can still tick it, and
   * unticking the repository's own is what makes it arrive.
   */
  yields?: true;
  /**
   * More than one of the repository's own declarations names this destination.
   *
   * Carries the paths that claim it, because no single one of them can be
   * unticked to rescue the row — leaving exactly one selected is what settles
   * it, and the user has to be told which ones are competing to do that
   * (design.md D3c).
   */
  contested?: true;
  /**
   * Why the host offered a row nobody configured — static host text from the
   * fallback detector. Its presence is what makes the row opt-in (D2 of
   * suggest-worktree-initialization).
   */
  suggestion?: string;
  /**
   * Index into `model.contenders`, for the notes above.
   *
   * A pointer, never a copy of the membership: a group is every entry sharing
   * one fold key, so at `MAX_MODEL_ROWS` it can hold every row the cap allows,
   * and copying its declarations into each note it explains is quadratic in a
   * checked-in file's own rows (.reviews/round-8.md F019).
   */
  group?: number;
}

/**
 * The offer as one flat list, in the order the section renders.
 *
 * Flat rather than grouped by kind because § 2.4's selection is one flat list of
 * ids — a UI that sorted rows by kind would have to be undone to submit them —
 * and one row per ITEM rather than the mockup's one row per kind because the
 * spec says each row names the file that declared it, which a "Copy 2 files"
 * row cannot do once two files came from two providers.
 */
export function bringRows(model: WorktreeProvisionOffer["model"]): BringRow[] {
  const rows: BringRow[] = [];
  const partners = contenderPartners(model);
  // The initial render has no selection yet, so it asks the predicate what the
  // DEFAULT would receive: every entry selected. That default is a fixed point
  // — a yielder is then refused and offered unticked, and an undecidable group
  // is refused and says so while staying ticked, because no tick state of it
  // succeeds (design.md D3c).
  const holding = new Set(model.entries.map((e) => e.id));
  const yielding = yieldsTo(model, holding);
  const grouped = groupIndex(model);
  const natives = model.contenders.map((c) => c.natives.length);
  for (const entry of model.entries) {
    const named = partners.get(entry.id);
    const loses = yielding.get(entry.id);
    const place = grouped.get(entry.id);
    const claiming = place === undefined ? 0 : (natives[place.group] ?? 0);
    rows.push({
      id: entry.id,
      verb: entry.mode === "link" ? "Link" : "Copy",
      subject: entry.path,
      source: entry.source,
      // A suggestion starts unchecked: nobody configured it, so nothing has
      // consented to it (suggest-worktree-initialization D2). A file the user
      // just picked is the exception: that gesture selected this create-only
      // row, and `addedForCreate` is presentation state only.
      checked: entry.addedForCreate === true || (entry.suggestion === undefined && loses === undefined),
      ...(entry.suggestion === undefined ? {} : { suggestion: entry.suggestion }),
      ...(entry.mode === "link" ? { warn: "writes to main" } : {}),
      ...(named === undefined ? {} : { contender: named }),
      ...(place === undefined ? {} : { group: place.group }),
      ...(place !== undefined && !place.native && claiming > 0 ? { yields: true } : {}),
      ...(claiming > 1 ? { contested: true } : {}),
    });
  }
  for (const port of model.ports) {
    rows.push({
      id: port.id,
      verb: "Allocate port",
      subject: port.port === undefined ? `${port.name} · preview unavailable` : `${port.name}=${port.port} · preview`,
      source: port.source,
      checked: true,
    });
  }
  for (const step of model.setup) {
    // Recognised by the host's marker string, never by position.
    const added = step.source === SETUP_STEP_ADDED_SOURCE;
    rows.push({
      id: step.id,
      verb: "Run setup",
      subject: step.script,
      source: step.source,
      // OFF for a command a provider file supplied: a checkbox that arrived
      // pre-ticked is not consent (worktree-provisioning.md § 7). ON for one
      // the user typed into this form — typing it is the consent.
      checked: added,
      ...(added ? { added: true } : {}),
      ...(step.suggestion === undefined ? {} : { suggestion: step.suggestion }),
    });
  }
  // Last, and after everything the section WILL do. `source` is the file that
  // originally declared the path, never the file that removed it: the row says
  // what was inherited and then dropped, and rewriting it would attribute the
  // declaration to the wrong file (§ 4.3).
  for (const entry of model.excluded) {
    rows.push({
      id: entry.id,
      verb: "Excluded",
      subject: entry.path,
      source: entry.source,
      checked: false,
      excluded: true,
    });
  }
  return rows;
}

/**
 * What each selectable row IS, independent of the id it was minted under.
 *
 * Item ids are offer-local — `messages.ts` says so, and the offer store remints
 * every one from a counter that never restarts — so a selection held under one
 * offer's ids names nothing under the next one's. A save answers with a fresh
 * offer, and without this the user's ticks were silently replaced by the new
 * model's defaults: every setup step they had turned ON came back OFF
 * (.reviews/round-2.md F018).
 *
 * The descriptor carries `source` and an occurrence index as well as the
 * subject. Two providers may declare the same script, and a single provider may
 * declare it twice — both are preserved rather than deduplicated
 * (`providerKit.ts` appends setup rows unconditionally), so the display text
 * alone would move one row's state onto another's.
 *
 * `excluded` rows are absent: they carry no checkbox, so they have no state to
 * carry anywhere.
 */
function rowDescriptors(model: WorktreeProvisionOffer["model"]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  const put = (id: string, base: string): void => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(id, `${base}\u0000${n}`);
  };
  for (const entry of model.entries) {
    put(entry.id, `entry\u0000${entry.path}\u0000${entry.mode}\u0000${entry.source}`);
  }
  for (const port of model.ports) {
    put(port.id, `port\u0000${port.name}\u0000${port.source}`);
  }
  for (const step of model.setup) {
    put(step.id, `setup\u0000${step.script}\u0000${step.source}`);
  }
  return out;
}

/** Offer ids change on reread; only semantically new file choices need fresh review. */
export function changedFileIds(
  before: WorktreeProvisionOffer["model"] | null,
  after: WorktreeProvisionOffer["model"],
): ReadonlySet<string> {
  if (before === null) {
    return new Set();
  }
  const known = new Set(rowDescriptors(before).values());
  const current = rowDescriptors(after);
  return new Set(after.entries.filter((entry) => !known.has(current.get(entry.id) ?? "")).map((entry) => entry.id));
}

/**
 * Move a selection off the offer it was taken under and onto the one answering it.
 *
 * Both the ticks and the unticks travel: a setup step the user turned ON stays
 * on, and an entry they turned OFF stays off even though the model offers it
 * ticked. A row the previous offer did not have is genuinely new, so it takes
 * the new model's default — which is the only state the user has expressed
 * nothing about.
 */
export function carryForward(
  before: WorktreeProvisionOffer["model"],
  kept: ReadonlySet<string>,
  rows: readonly BringRow[],
  after: WorktreeProvisionOffer["model"],
): Set<string> {
  const was = rowDescriptors(before);
  const keptKeys = new Set<string>();
  for (const id of kept) {
    const key = was.get(id);
    if (key !== undefined) {
      keptKeys.add(key);
    }
  }
  const known = new Set(was.values());
  const now = rowDescriptors(after);
  const next = new Set<string>();
  for (const row of rows) {
    const key = now.get(row.id);
    if (key !== undefined && known.has(key)) {
      if (keptKeys.has(key)) {
        next.add(row.id);
      }
    } else if (row.checked) {
      next.add(row.id);
    }
  }
  return next;
}

/**
 * `2 copied · 1 linked · 1 port · 1 setup step` — what the section will do.
 *
 * Four states, four sentences. "Nothing configured" is a repository that
 * declares nothing; "Could not be read" is a provider file that failed; "Not
 * saved" is a save that was refused about a file that read fine. They are not
 * the same claim, and a single blank summary would make them look alike.
 */
export function bringSummary(model: WorktreeProvisionOffer["model"], selected: ReadonlySet<string>): string {
  // The entry counts follow the SELECTION, not the model. A member yielding to
  // the repository's own starts unticked, so counting the model would say a
  // file will be brought over that the apply refuses on every volume
  // (`award-a-contested-destination-or-refuse-it/.reviews/round-3.md` F007) —
  // and the user may then untick the favoured one and tick the yielder, which
  // reverses which of the two arrives (round-1 F001).
  //
  // Ports and setup steps still count what the offer DECLARES. That is
  // pre-existing — a setup step is offered unticked and still counted, because
  // the line says what the repository asks for and the checkbox says whether it
  // is granted — and this change does not own it.
  const yielding = yieldsTo(model, selected);
  const contested = refusedEntire(model, selected);
  const brought = model.entries.filter((e) => {
    if (!selected.has(e.id)) {
      return false;
    }
    // Nothing in a group with two selected repository declarations arrives:
    // the apply refuses it entire before it reads anything (design.md D3b).
    if (contested.has(e.id)) {
      return false;
    }
    // Selected is not the same as arriving. A yielder the user ticked BACK ON
    // while its counterpart is still selected is refused by the apply exactly
    // as if it had been left unticked, so counting it says the row will arrive
    // while the note on that same row says it will be refused
    // (`.reviews/round-5.md` F007).
    const favoured = yielding.get(e.id);
    return favoured === undefined || !selected.has(favoured.id);
  });
  // What the SAVE did outranks what the model contains, and it is checked here
  // rather than after the counts because the counts return early. A model with
  // contents therefore never reached the answers below — which is how a
  // written-but-locked save went unreported (round-1 F002, design.md D4).
  const saveOutcome = saveSummary(model.problems);
  if (saveOutcome !== undefined) {
    return saveOutcome;
  }
  const copied = brought.filter((e) => e.mode === "copy").length;
  const linked = brought.length - copied;
  const parts: string[] = [];
  if (copied > 0) {
    parts.push(`${copied} copied`);
  }
  if (linked > 0) {
    parts.push(`${linked} linked`);
  }
  if (model.ports.length > 0) {
    parts.push(`${model.ports.length} port${model.ports.length === 1 ? "" : "s"}`);
  }
  // A suggested step counts only once selected: the declared-count rationale
  // above is about what the REPOSITORY asks for, and a fallback suggestion is
  // not the repository asking (suggest-worktree-initialization D2).
  const setupCount = model.setup.filter((s) => s.suggestion === undefined || selected.has(s.id)).length;
  if (setupCount > 0) {
    parts.push(`${setupCount} setup step${setupCount === 1 ? "" : "s"}`);
  }
  if (model.contenders.length > 0) {
    // The counts above exclude the members that yield, but a group with no
    // favoured member yields nobody: its rows are all offered, all counted, and
    // which one gives way cannot be known before the worktree exists (design
    // D2). The line covers both — a settled group still tells the user why a
    // spelling it can see is not in the count.
    //
    // Counted from the members, never called a "pair": a group is a connected
    // component and three spellings of one name are one group, so the word
    // understated a three-way collision by exactly the row it did not mention
    // (round-1 F004).
    const groups = model.contenders;
    const first = groups[0];
    parts.push(
      groups.length === 1 && first !== undefined
        ? `${first.members.length} spellings may be one file`
        : `${groups.length} sets of spellings may each be one file`,
    );
  }
  if (parts.length > 0) {
    return parts.join(" \u00b7 ");
  }
  // Nothing to do. WHY there is nothing is the distinction that matters: a file
  // that failed to parse would have produced entries if it had parsed, and a
  // suggestion set nobody touched is an unanswered offer, not a repository
  // that configured nothing.
  if (model.problems.length === 0) {
    const suggested =
      model.entries.some((e) => e.suggestion !== undefined) || model.setup.some((s) => s.suggestion !== undefined);
    return suggested ? "No suggestions selected" : "Nothing configured";
  }
  return "Could not be read";
}

/**
 * The answer a save forces, or `undefined` when the save has nothing to say.
 *
 * A refusal outranks a lock: the write that did not happen is what the user must
 * deal with first, and `refused` on the lock report is the same event seen from
 * the other side. Below that, the lock report says what the save DID — calling a
 * no-op saved is the thing the spec forbids outright.
 *
 * A save that was refused is its own statement, not "could not be read": the
 * file read perfectly well, and saying otherwise about a file this form has just
 * rendered the contents of is the category error `unsaved` exists to end (D13).
 */
function saveSummary(problems: WorktreeProvisionOffer["model"]["problems"]): string | undefined {
  if (problems.some((p) => p.reason === "unsaved")) {
    return "Not saved";
  }
  const locked = problems.filter((p) => p.reason === "locked");
  if (locked.length === 0) {
    return undefined;
  }
  if (locked.some((p) => p.writeOutcome === "refused")) {
    return "Not saved";
  }
  // A lock never speaks over a file that could not be READ. This is the old
  // `every((p) => p.reason === "locked")` restated: the lock answer applies only
  // when a lock is the only kind of problem. Splitting the helper out dropped it,
  // and a headline claiming a save landed over an unreadable provider file is
  // the same falsehood F002 was about (round-2 F005).
  if (problems.some((p) => p.reason !== "locked")) {
    return undefined;
  }
  return locked.some((p) => p.writeOutcome === "written")
    ? "Saved, may still be locked"
    : "Already up to date, may still be locked";
}
