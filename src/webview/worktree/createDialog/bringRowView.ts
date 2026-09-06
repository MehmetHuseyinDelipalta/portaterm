// src/webview/worktree/createDialog/bringRowView.ts — How one provisioning row
// is drawn: the row itself, a provider switch, an unreadable provider file, and
// the buttons on an added setup step.
//
// Extracted from `WorktreeCreateDialog.ts` by change `decompose-create-dialog`
// (design.md D1, task 1_3). Already module-level, so the cut is a move: no body
// changes, only the import list.
//
// These read `BringRow`'s flags and recompute nothing the model owns — which
// row yields, which group is refused entire, and what the summary says are all
// decided in `bringContention.ts` and `bringSummaries.ts` before a row is drawn.
// Two branches here are still rendering POLICY rather than pure markup: the
// added-step controls, and omitting the checkbox on an excluded row. Both
// consume explicit `BringRow` flags rather than re-deriving them.
//
// No suite beside this file, deliberately (design.md D2). The 386-case dialog
// suite already drives every one of these through `openWorktreeCreateDialog` —
// rows, problems and switches, and the added-step actions with their clipped
// names — and a second assertion of the same markup proves nothing.

import { ICON_CLOSE, ICON_RENAME } from "../../vault/icons";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import type { BringRow } from "./bringSummaries";

/**
 * A provider file that is present and unusable, named.
 *
 * `detail` can quote arbitrary content back out of a parser, so it is set with
 * `textContent` and never interpreted. There is no "Open file" affordance: the
 * only open-a-file message this webview has resolves its path against a
 * terminal's cwd, and an inert button is worse than none.
 */
export function bringProblem(problem: WorktreeProvisionOffer["model"]["problems"][number]): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-bring-problem";
  const file = document.createElement("b");
  file.className = "wt-bring-problem-file";
  file.textContent = problem.file;
  const detail = document.createElement("span");
  detail.className = "wt-bring-problem-detail";
  detail.textContent = problem.detail;
  el.append(file, detail);
  return el;
}

/**
 * A source that was detected and did not supply the offer.
 *
 * One row per source, naming every file it reads — orca is one provider over
 * two, and a row naming one of them would be telling the user something other
 * than what the host read (design.md D8). Hiding it instead would leave a
 * repository looking as if it had never configured the tool it uses.
 */
export function switchRow(
  provider: WorktreeProvisionOffer["model"]["providers"][number],
  take: () => void,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-bring-switch";
  const files = document.createElement("span");
  files.className = "wt-bring-switch-files";
  // Provider-file text, set with `textContent` like every other piece of it.
  files.textContent = provider.files.join(", ");
  const take_ = document.createElement("button");
  // Explicitly a button. A default-type button inside the form SUBMITS, and a
  // switch that created a worktree is the one thing this must never do.
  take_.type = "button";
  take_.className = "wt-bring-switch-take";
  take_.textContent = "Use this instead";
  // The visible label is the same on every row, and the file list that tells
  // them apart sits beside the button rather than inside it — so to a screen
  // reader walking the controls every choice announced itself identically
  // (.reviews/round-1.md F006). Naming the button after its own source is what
  // makes the rows distinguishable without changing what is drawn.
  take_.setAttribute("aria-label", `Use ${provider.files.join(", ")} instead`);
  take_.addEventListener("click", take);
  el.append(files, take_);
  return el;
}

/**
 * One row: a checkbox, the verb and its source on the first line, the subject on
 * the second.
 *
 * Every piece of provider-file text — the subject and the source path — is set
 * with `textContent`. None of it is interpreted as markup, which is the rule the
 * whole untrusted-provider-file model rests on.
 */
/** Characters of the script an action's accessible name carries. */
const STEP_NAME_CHARS = 48;

/**
 * The accessible name of an added row's action: the action, the row's ordinal
 * among added steps and a clipped script. The full command interpolated here
 * made a 4096-character name, announced twice per row (round 2 F006); the code
 * cell still carries all of it.
 */
function stepName(action: "Edit" | "Remove", ordinal: number, script: string): string {
  const clipped = script.length > STEP_NAME_CHARS ? `${script.slice(0, STEP_NAME_CHARS - 1)}…` : script;
  return `${action} setup step ${ordinal + 1}: ${clipped}`;
}

function stepButton(
  icon: string,
  name: string,
  className: string,
  click: (button: HTMLButtonElement) => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  // Explicitly a button: a default-type button inside the form SUBMITS.
  b.type = "button";
  b.className = `wt-brow-step ${className}`;
  b.innerHTML = icon;
  b.setAttribute("aria-label", name);
  b.title = name;
  b.addEventListener("click", () => click(b));
  return b;
}

export function bringRow(
  row: BringRow,
  index: number,
  onStep?: (kind: "edit" | "remove", itemId: string, control?: HTMLElement) => void,
  addedOrdinal = 0,
): HTMLElement {
  const el = document.createElement("div");
  el.className = row.excluded === true ? "wt-brow wt-brow--excluded" : "wt-brow";
  const topId = `wt-brow-top-${index}`;
  const metaId = `wt-brow-meta-${index}`;
  const top = document.createElement("label");
  top.className = "wt-brow-top";
  top.id = topId;
  const verb = document.createElement("b");
  verb.textContent = row.verb;
  top.appendChild(verb);
  if (row.warn !== undefined) {
    // Part of the row, not a notice: the spec makes this statement
    // unsuppressible, and anything dismissible is suppressible.
    const warn = document.createElement("span");
    warn.className = "wt-brow-warn";
    warn.textContent = row.warn;
    top.appendChild(warn);
  }
  if (row.excluded === true) {
    // Says the removal was asked for. Without it the row reads as one more
    // thing the create will do, which is the opposite of what it means.
    const mark = document.createElement("span");
    mark.className = "wt-brow-excluded";
    mark.textContent = "removed on purpose";
    top.appendChild(mark);
  }
  // The source badge is the row's last cell, a sibling of both halves rather
  // than inside the verb's label: the checkbox announces verb and subject, and
  // the file that declared them is not part of the name.
  const src = document.createElement("span");
  src.className = "wt-brow-src";
  src.textContent = row.source;
  if (row.added === true && onStep !== undefined) {
    // Only a row the host marked. A provider-declared step is not the form's
    // to edit, and the host would refuse the ask anyway (design.md D3).
    src.append(
      stepButton(ICON_RENAME, stepName("Edit", addedOrdinal, row.subject), "wt-brow-step-edit", (b) =>
        onStep("edit", row.id, b),
      ),
    );
    src.append(
      stepButton(ICON_CLOSE, stepName("Remove", addedOrdinal, row.subject), "wt-brow-step-remove", (b) =>
        onStep("remove", row.id, b),
      ),
    );
  }
  const meta = document.createElement("div");
  meta.className = "wt-brow-meta";
  meta.id = metaId;
  const code = document.createElement("code");
  code.className = "wt-brow-code";
  code.textContent = row.subject;
  meta.appendChild(code);
  if (row.contender !== undefined) {
    // Inside the meta line the subject already owns, not a sibling block: the
    // note is about THIS spelling, and `wt-brow` keeps one rendering owner.
    // The partner spelling is provider-file text like any other subject, so it
    // is set with `textContent`.
    const note = document.createElement("span");
    note.className = "wt-brow-note";
    note.textContent = `may be the same file as ${row.contender.join(", ")}`;
    meta.appendChild(note);
  }
  if (row.yields === true && row.group !== undefined) {
    // Said, not merely unchecked: an unticked row with no reason reads as an
    // oversight, and the reason is the one thing that tells the user ticking it
    // will not work while its counterpart stays selected.
    //
    // Left empty here and filled by `syncYieldNotes` from the selection: WHICH
    // declaration this row yields to is not a fact about the offer once the
    // group holds more than one of the repository's own.
    const note = document.createElement("span");
    note.className = "wt-brow-note wt-brow-yield";
    note.dataset.group = String(row.group);
    meta.appendChild(note);
  }
  if (row.suggestion !== undefined) {
    // The reason a row nobody configured is here at all. Host text — but set
    // with `textContent` anyway, like every other note in this section.
    const why = document.createElement("span");
    why.className = "wt-brow-note wt-brow-suggested";
    why.textContent = row.suggestion;
    // On the row's line rather than under it, so a narrow panel clips it. The
    // secrets warning is the only on-screen marker that a row is a secret file,
    // so it stays reachable when clipped instead of disappearing with the
    // measure.
    why.title = row.suggestion;
    why.setAttribute("aria-label", row.suggestion);
    meta.appendChild(why);
  }
  if (row.contested === true && row.group !== undefined) {
    // Live like the yielding note, and for the same reason: the user settles
    // this by leaving exactly one of the group's declarations selected, and a
    // standing notice would then describe a state that has lapsed. Which
    // declarations it NAMES follows the selection too — visibility needs only
    // two of them, so naming a third the user unticked describes a selection
    // nobody holds (.reviews/round-8.md F018).
    const note = document.createElement("span");
    note.className = "wt-brow-note wt-brow-contested";
    note.dataset.group = String(row.group);
    meta.appendChild(note);
  }
  if (row.excluded === true) {
    // No checkbox at all, rather than a disabled one: a disabled input is still
    // an input, and the submit path collects `.wt-brow-cb` by class. An id that
    // never reaches the DOM cannot reach the draft.
    el.append(top, meta, src);
    return el;
  }
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "wt-brow-cb";
  cb.id = `wt-brow-${index}`;
  // The host's own opaque id. Never the path: a value carrying one would make
  // the webview the authority on what gets materialized (§ 4.0).
  cb.value = row.id;
  cb.checked = row.checked;
  // The subject is what distinguishes one row from another, and it sits outside
  // the label as its own cell — so five rows from one provider announced as five
  // identical "Copy asimov/worktree.yaml" (.reviews/round-1.md W3). Both halves
  // are named explicitly instead.
  cb.setAttribute("aria-labelledby", `${topId} ${metaId}`);
  top.htmlFor = cb.id;
  el.append(cb, top, meta, src);
  return el;
}
