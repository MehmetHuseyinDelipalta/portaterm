// src/webview/worktree/createDialog/branchChoices.ts — What the branch box is
// offering, what the user picked from it, and what a pull request said about
// where its head lives.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-worktree-webview`
// (design.md D1, task 2_2). The ordering rules were already module-level pure
// functions; `choice`, `choices` and `forkHead` were not, so the order they
// produce could only be asked about through a rendered listbox.
//
// What did NOT come with them:
//
//   * `activeAt` and `listOpen` — which row is highlighted and whether the popup
//     is up. That is the dropdown's presentation, and it moves with the DOM.
//   * `renderList`, `setActive`, `openList`, `closeList` — the same.
//   * the mode guard that refuses to demote a RESOLVED `adopt`/`reattach`. It
//     reads the host's standing resolution, which is not this module's; the
//     dialog keeps it and asks `mode()` for the rest.
//
// No environment pragma on the suite beside this file, so it runs under node: a
// DOM reference reaching in here throws rather than passing quietly under the
// dialog's jsdom (OBL-4's rule, applied to the second module).

import type { PullRequestOffer } from "../../../types/messages";
import type { WorktreeBranchMode, WorktreePullRequestOffer, WorktreeRef } from "../worktreeViewTypes";

/**
 * One row of the branch list: an existing ref, or the always-present entry that
 * creates the typed name.
 *
 * The create-new row is a member rather than a special case below the list —
 * it is what makes a repository whose enumeration failed still usable, so it
 * cannot be something the list's presence gates.
 */
export type BranchChoice =
  | { kind: "existing"; ref: WorktreeRef }
  | { kind: "pr"; pr: PullRequestOffer }
  | { kind: "prsUnavailable" }
  | { kind: "new" };

/** The label the create-new row echoes the typed name back under. */
export const CREATE_ROW_LABEL = "Create branch";

/**
 * The fork head of the pull request currently selected, and which selection it
 * describes.
 *
 * Carried WITH its repository and branch rather than as a bare flag: the note is
 * a claim about one create, and the same rule the resolutions follow applies —
 * an answer the user has typed past describes a selection that is gone, so it is
 * withdrawn by not matching rather than by every caller remembering to clear it.
 */
export interface ForkHead {
  readonly repoId: string;
  readonly branch: string;
  readonly owner: string;
}

/** What taking a row decides, with none of it done. */
export type CommitDecision =
  | { readonly kind: "ignored" }
  /** Refused, and SAID: silence is indistinguishable from a dropped keypress. */
  | { readonly kind: "refused"; readonly message: string }
  | {
      readonly kind: "taken";
      readonly choice: BranchChoice;
      /** The name to state, where the row settles one. */
      readonly branchName?: string;
      /** The base the pull request answers with, where the row is one. */
      readonly baseRef?: string;
    };

/**
 * What a pull request names as a branch: `pr/<number>` and nothing else (D4).
 *
 * Not the title, not `headRefName` — both belong to the pull request's author
 * and both can be renamed. A worktree that changes identity when someone edits
 * a title is not the same worktree tomorrow.
 */
export function branchOfPullRequest(pr: PullRequestOffer): string {
  return `pr/${pr.number}`;
}

/**
 * The pull-request part of the one list, between the prefix matches and
 * create-new (§ 4.1).
 *
 * `undefined` is "not asked yet" and contributes nothing — the form must not
 * claim a forge state it has not been told. `available: false` contributes the
 * single quiet row § 5 asks for, whatever the reason was.
 *
 * Matching is on the number and on the title, because those are what a user
 * has in hand. Never on `headRefName`: the branch a create mints is
 * `pr/<number>` and offering to match the fork's own branch name would suggest
 * that is what gets checked out.
 *
 * The title matches ANYWHERE, where a ref matches only by prefix. That
 * asymmetry is deliberate: a branch name is hierarchical and a prefix is what
 * someone is completing, while a title is prose and a prefix rule would make
 * titles effectively unsearchable.
 */
export function pullRequestChoices(offer: WorktreePullRequestOffer | undefined, query: string): BranchChoice[] {
  if (offer === undefined) {
    return [];
  }
  if (!offer.available) {
    return [{ kind: "prsUnavailable" }];
  }
  const needle = query.toLowerCase();
  return offer.list
    .filter(
      (pr) => needle.length === 0 || String(pr.number).startsWith(needle) || pr.title.toLowerCase().includes(needle),
    )
    .map((pr) => ({ kind: "pr", pr }) as const);
}

/**
 * Ordered by what the typed text most likely means: the exact match, then the
 * prefixes, then create-new. With nothing typed every ref is offered.
 *
 * Refs that neither match exactly nor by prefix are dropped — the list is a
 * filter over one dataset, which is the whole reason § 4.1 rejected tabs.
 */
export function orderChoices(
  refs: readonly WorktreeRef[],
  typed: string,
  pullRequests?: WorktreePullRequestOffer,
): BranchChoice[] {
  const query = typed.trim();
  const exact: BranchChoice[] = [];
  const prefixed: BranchChoice[] = [];
  for (const ref of refs) {
    if (query.length === 0 || ref.name === query) {
      (query.length === 0 ? prefixed : exact).push({ kind: "existing", ref });
    } else if (ref.name.startsWith(query)) {
      prefixed.push({ kind: "existing", ref });
    }
  }
  return [...exact, ...prefixed, ...pullRequestChoices(pullRequests, query), { kind: "new" }];
}

/**
 * What a capped list says about itself.
 *
 * Branches and pull requests are capped independently and answer the typed text
 * differently: a branch past the cap can still be reached by typing, because the
 * host re-reads on the query, while pull requests are filtered locally out of
 * the one page that was fetched. So the two are not one sentence with a
 * substituted noun (.reviews/round-1.md B3).
 */
export function partialListText(refsPartial: boolean, prsPartial: boolean): string {
  const parts: string[] = [];
  if (refsPartial) {
    parts.push("Showing part of this repository's branches — type to find others.");
  }
  if (prsPartial) {
    parts.push("Showing part of this repository's open pull requests; the rest are not searchable here.");
  }
  return parts.join(" ");
}

/** The wire mode a choice means. `detached` is the toggle's and never a row's. */
export function choiceMode(c: BranchChoice): WorktreeBranchMode {
  return c.kind === "existing" ? "existing" : "new";
}

export interface BranchChoicesDeps {
  /** The refs the current repository was told about; empty until it is told. */
  refs(): readonly WorktreeRef[];
  /** The repository the form is on NOW — a fork head is a claim about one. */
  repoId(): string;
  pullRequests(): WorktreePullRequestOffer | undefined;
}

export interface BranchChoices {
  /** What the user picked, and the ONLY source of new-versus-existing (D4). */
  choice(): BranchChoice;
  /** Rows the list is currently offering, in order. Index into the listbox. */
  rows(): readonly BranchChoice[];
  /** The wire mode the current choice means. */
  mode(): WorktreeBranchMode;

  /** Re-decide the rows for the text currently typed, and return them. */
  offer(typed: string): readonly BranchChoice[];

  /**
   * Re-decide what the typed text means, against the repository the form is on
   * NOW. The single source D4 claims: the choice is derived here and nowhere
   * else.
   *
   * Two-way on purpose. Only ever upgrading to `existing` left a branch that
   * exists in one repository still submitting as `existing` after a switch to
   * one where it does not (round-1 B2).
   */
  derive(typed: string): BranchChoice;

  /** Take row `at` as the selection. The caller applies what comes back. */
  commit(at: number): CommitDecision;

  /**
   * Detached SURRENDERS the pull request as the source: it creates at a ref and
   * mints no branch, so `pr/<n>` is no longer what this create is about.
   * Withdrawn rather than hidden, because leaving detached re-derives the
   * still-present text as an ordinary branch and would otherwise resurrect a
   * statement nobody re-selected (.reviews/round-2.md B2).
   */
  clearForkHead(): void;

  /**
   * The fork head only while it still describes THIS selection, on THIS
   * repository, under a mode that still uses the pull request as its source.
   */
  forkStated(typedBranch: string, branchMode: WorktreeBranchMode): ForkHead | null;
}

export function createBranchChoices(deps: BranchChoicesDeps): BranchChoices {
  let choice: BranchChoice = { kind: "new" };
  let choices: BranchChoice[] = [];
  let forkHead: ForkHead | null = null;

  return {
    choice: () => choice,
    rows: () => choices,
    mode: () => choiceMode(choice),

    offer(typed) {
      choices = orderChoices(deps.refs(), typed, deps.pullRequests());
      return choices;
    },

    derive(typed) {
      const named = typed.trim();
      const exact = named.length === 0 ? undefined : deps.refs().find((r) => r.name === named);
      choice = exact === undefined ? { kind: "new" } : { kind: "existing", ref: exact };
      return choice;
    },

    commit(at) {
      const row = choices[at];
      if (row === undefined || row.kind === "prsUnavailable") {
        return { kind: "ignored" };
      }
      // A pull request is a SOURCE, not a third kind of branch. It names a branch
      // and a base, and from there it is the same question a typed name asks — so
      // it is decided here against the same refs, and later by the same
      // resolution: reuse, held-by and collision stay answered in one place.
      const named = row.kind === "pr" ? branchOfPullRequest(row.pr) : undefined;
      const already = named === undefined ? undefined : deps.refs().find((ref) => ref.name === named);
      const picked: BranchChoice =
        named === undefined ? row : already === undefined ? { kind: "new" } : { kind: "existing", ref: already };
      if (picked.kind === "existing" && picked.ref.heldBy !== undefined) {
        // Refused, and SAID. Silence here is indistinguishable from a dropped
        // keypress, and the explanation already exists (round-1 S2).
        return { kind: "refused", message: `${picked.ref.name} is checked out in ${picked.ref.heldBy}` };
      }
      choice = picked;
      if (named !== undefined && row.kind === "pr") {
        // The two fields the pull request answers, handed back for the inputs to
        // state — there is no second resolution for pull requests.
        forkHead = row.pr.fromFork ? { repoId: deps.repoId(), branch: named, owner: row.pr.headOwner } : null;
        return { kind: "taken", choice: picked, branchName: named, baseRef: row.pr.baseRefName };
      }
      return picked.kind === "existing"
        ? { kind: "taken", choice: picked, branchName: picked.ref.name }
        : { kind: "taken", choice: picked };
    },

    clearForkHead() {
      forkHead = null;
    },

    forkStated(typedBranch, branchMode) {
      // Detached submits a base and no branch at all, so the pull request is not
      // what it creates from and the statement would describe a different
      // operation (.reviews/round-1.md B2). `clearForkHead` is what stops the
      // note coming back on the way out (round-2 B2); this condition stays so
      // the note is off under detached whatever set the state.
      return forkHead !== null &&
        forkHead.repoId === deps.repoId() &&
        forkHead.branch === typedBranch.trim() &&
        branchMode !== "detached"
        ? forkHead
        : null;
    },
  };
}
