// src/webview/worktree/createDialog/dialogDeps.ts — The channels the host offers
// this form: what it asks for, and what it will be told back.
//
// Extracted from `WorktreeCreateDialog.ts` by change `decompose-create-dialog`
// (design.md D1, task 1_10). Nothing here executes; it is the contract, and it
// sat above a thousand lines of the form that consumes it. The prose on each
// field is why the channel is separate from its neighbours, which is a question
// about the host and not about the DOM below it — so it reads better here, and
// `hostBindings.ts` can now name the real type rather than restate eight of
// these fields structurally.
//
// The facade re-exports it: every caller has always imported it from there.

import type {
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
  WorktreeSetupStepAskMessage,
} from "../../../types/messages";
import type {
  WorktreeCreateDefaults,
  WorktreeCreateDraft,
  WorktreeMigrationOffer,
  WorktreeProvisionOffer,
  WorktreePullRequestOffer,
  WorktreeRefOffer,
} from "../worktreeViewTypes";
import type { CreateSelection } from "./resolutionAsks";

export interface WorktreeCreateDialogDeps {
  /** Present only when the host is the bottom-panel terminal surface. */
  onTogglePanelSize?: () => void;
  /** One entry per repo; a single entry suppresses the picker entirely (§ 3.2). */
  repos: WorktreeCreateDefaults[];
  /** Which repo the create was invoked from. */
  initialRepoId?: string;
  /**
   * The selection changed, so what a create would do has to be resolved again —
   * only the host can say which path is free and whether the base names a
   * commit. Called on every SETTLED edit, and it carries the whole selection
   * rather than just the branch: a base or a destination the host is never told
   * about is a field the resolution cannot be about (round-3 B4).
   */
  onSelectionChange?: (selection: CreateSelection) => void;
  /**
   * Receive the function that applies a fresh answer from the host. Kept as a
   * callback rather than a return value so the form stays a single expression
   * for every caller that does not need to update it.
   */
  bindDefaults?: (apply: (next: WorktreeCreateDefaults) => void) => void;
  /**
   * Receive the function that applies a fresh provisioning offer.
   *
   * Separate from `bindDefaults` on purpose. The destination is answered per
   * keystroke and the form gates Create on that answer being current; this
   * channel answers the opening and its source/save/input operations without
   * touching the destination gate. Routing an offer through the destination's
   * callback let it clear that gate, so Create went live on the path resolved
   * for the opening ask (.reviews/round-1.md B4).
   */
  bindProvisioning?: (apply: (repoId: string, offer: WorktreeProvisionOffer) => void) => void;
  /** Receive the function that replaces the current source-snapshot move offer. */
  bindMigration?: (apply: (repoId: string, offer: WorktreeMigrationOffer | undefined) => void) => void;
  /**
   * Receive the function that applies the repository's branch list.
   *
   * Its own channel for the same reason as `bindProvisioning`: this answers
   * once per form and gates nothing, while the destination is answered per
   * settled edit and Create waits on it. Routing one through the other's
   * callback is what B4 was.
   */
  bindRefs?: (apply: (repoId: string, refs: WorktreeRefOffer) => void) => void;
  /**
   * Populate the section from a source that was detected but did not win.
   *
   * Carries the provider's ID and a sequence this form mints, and nothing else.
   * A dep that could carry a file, a path or a model would make the webview the
   * authority on what the host reads (design.md D5). Taking it submits nothing:
   * the host answers with a fresh offer, which arrives through
   * `bindProvisioning` like any other.
   */
  onProvisionSwitch?: (request: { repoId: string; switch: number; provider: string }) => void;
  /**
   * Record the current selection in the repository's own configuration.
   *
   * Carries the host's opaque item ids, the offer that named them, and the
   * ordering fields — no path, no key, no file text. A dep that could carry any
   * of those would make the webview the authority on what the repository's
   * configuration SAYS, which is the same rule `onProvisionSwitch` obeys one
   * hop earlier (design.md D1).
   *
   * `switch` comes from the same sequence the switch mints, so a save and a
   * source change order against each other rather than racing (design.md D8).
   */
  onProvisionSave?: (request: { repoId: string; switch: number; offerId: string; kept: readonly string[] }) => void;
  /**
   * Ask the host to open its system picker for one file to copy in this create.
   *
   * The form sends only the repository and shared ordering sequence. The host
   * owns the picker, path, holder and fresh offer that answers this ask.
   */
  onCopyFileAsk?: (request: { repoId: string; switch: number }) => void;
  /**
   * Ask the host to open ITS input for a setup step that applies to this
   * create only, or to edit or remove one it already holds.
   *
   * Carries an operation and, for edit and remove, the host's own ids — never
   * the text. What the user types exists first in the extension host and comes
   * back as display material inside a fresh offer through `bindProvisioning`,
   * the same way every provider-declared script already arrives
   * (add-a-setup-step-for-this-create-only/design.md D1, D2).
   *
   * `switch` comes from the same sequence the switch and the save mint, so the
   * three order against each other.
   */
  onSetupStepAsk?: (request: { repoId: string; switch: number; op: WorktreeSetupStepAskMessage["op"] }) => void;
  /** The forge's answer, on its own channel — it must never gate `bindRefs`. */
  bindPullRequests?: (apply: (repoId: string, offer: WorktreePullRequestOffer) => void) => void;
  /**
   * What a create against the settled selection would actually do.
   *
   * The form applies an answer only while `query` still matches what is typed:
   * a resolution the user has typed past describes a selection that is gone,
   * and applying it would state a mode nobody chose (design.md D1).
   */
  bindResolution?: (apply: (resolution: WorktreeCreateResolutionMessage) => void) => void;
  /**
   * Ask the host to authorize clearing this directory.
   *
   * Its own request, sent only when the user ACCEPTS the offer. The resolution
   * carries no authorization because it is answered on every settled edit, and
   * a token minted per keystroke is one nobody asked for (design.md D6).
   */
  onAuthorizeDebris?: (request: { repoId: string; ask: number; path: string }) => void;
  /**
   * Receive the function that applies the host's answer to that request.
   *
   * Paired with `onAuthorizeDebris`: without both, no answer can ever arrive,
   * and an offer that cannot be authorized is a control that does nothing — so
   * the offer is not rendered at all.
   */
  bindDebrisAuthorization?: (apply: (answer: WorktreeDebrisAuthorizedMessage) => void) => void;
  /**
   * Ask the host to open the system folder picker for this form.
   *
   * Carries the repository and nothing else: the opening is the owner's, added
   * where every other create request's is, so this form states no identity of
   * its own and no second place decides whether an answer belongs here
   * (design.md D2).
   */
  onPickDestination?: (request: { repoId: string; ask: number }) => void;
  /**
   * Receive the function that applies a picked folder.
   *
   * Paired with `onPickDestination` for the same reason `bindDebrisAuthorization`
   * is paired with `onAuthorizeDebris`: without both, no answer can arrive, and
   * an action that cannot be answered is a control that does nothing — so it is
   * not rendered at all.
   */
  bindDestinationPicked?: (apply: (answer: WorktreeDestinationPickedMessage) => void) => void;
  onSubmit: (draft: WorktreeCreateDraft) => void;
  onCancel?: () => void;
}
