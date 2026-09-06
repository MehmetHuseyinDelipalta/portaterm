// src/providers/worktreeHost/hostTypes.ts — The host contract the action modules share.
//
// Extracted by change `decompose-worktree-host-controller` (design.md D1, task 2_0).
// Every action factory's `Deps` names `WorktreeSurface` and `WorktreeActions`, and
// the launch arms name `AdmittedLaunch`; two of those were unexported, so each
// action module would otherwise have had to reach back into `WorktreeHost.ts` and
// make its type graph circular. One owner instead.
//
// Types only — this module imports nothing from `WorktreeHost.ts`, which is what
// keeps the dependency one-way.

import type {
  BranchDeleteRequest,
  DestinationDisposition,
  ExtensionToWebViewMessage,
  ProvisionPort,
  ProvisionSetupStep,
  WorktreeAfterCreate,
  WorktreeCreateMode,
  WorktreeRemoveAssessmentMessage,
} from "../../types/messages";
import type { HeldRegularFile } from "../../utils/heldRegularFile";
import type { VaultLaunchTarget } from "../../vault/types";
import type { CreateSessionOptions } from "../../vault/VaultLauncher";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../../worktree/migrateChanges";
import type { ProvisionMaterial } from "../../worktree/provisioning/provisionMaterial";

/** Where a launch would run, and which observation of it that answer came from. */
export interface LaunchTargetRecord {
  path: string;
  generation: number;
}

/**
 * One admission's whole answer.
 *
 * Returned instead of a boolean so a caller cannot check one value and act on
 * another — the shape `matchedRow` already uses for session rows, and the shape
 * rounds 1-4 kept finding defects for the lack of (design.md D10).
 */
export interface AdmittedLaunch extends LaunchTargetRecord {
  worktreeId: string;
}

export interface WorktreeSurface {
  isReady(): boolean;
  post(message: ExtensionToWebViewMessage): void;
  /**
   * Open a terminal in THIS surface's view, at a path the host resolved.
   *
   * Here rather than in {@link WorktreeActions} because creating a pane is
   * `createSession(viewId, webview, {cwd})`, and only the provider that built
   * this surface holds both. The host still resolves which path — this receives
   * the value it looked up, never an id (design.md D2).
   *
   * Optional like every other capability: a surface that does not implement it
   * offers no terminals, exactly as it behaved before actions existed.
   */
  openTerminal?(cwd: string): Promise<void>;
  /**
   * Open a pane running an already-resolved launch, in THIS surface's view.
   *
   * Here rather than in {@link WorktreeActions} for the same reason as
   * `openTerminal`: creating a pane is `createSession(viewId, webview, …)` and
   * only the provider that built this surface holds both. What it receives is a
   * resolved command — the host decided WHICH agent and WHERE, and the launcher
   * turned that into argv; the surface only spawns it.
   */
  launchAgent?(options: CreateSessionOptions): Promise<void>;
}

/**
 * The panel's read-only capabilities, injected because none of them belong to a
 * component that holds a tree.
 *
 * Opening a terminal is deliberately NOT here — see `WorktreeSurface`.
 * `focusPane` takes the view the pane lives in, not the view that asked — revealing the asking surface would focus a pane the user
 * cannot see whenever the panel is open in two places (D4).
 */
export interface PickedCopyFile {
  readonly path: string;
  readonly canonicalPath: string;
  readonly file: HeldRegularFile;
}

export interface WorktreeActions {
  openFolder(path: string, mode: "newWindow" | "addToWorkspace"): Promise<void>;
  revealInOS(path: string): Promise<void>;
  /**
   * The folder the user chose, or `undefined` for a cancelled or failed picker.
   *
   * Optional like every other capability here: a host wired without it offers no
   * picker at all, rather than a control that resolves to nothing.
   */
  pickFolder?(): Promise<string | undefined>;
  /** Safely held file selected through the extension-owned picker. */
  pickCopyFile?(repoRoot: string): Promise<PickedCopyFile | undefined>;
  /**
   * The setup command the user typed into the HOST's own input, or `undefined`
   * for a dismissed or failed input. `current` seeds the input when an existing
   * step is being edited.
   *
   * Optional like `pickFolder`, and for the same reason. The text it returns
   * exists first here and reaches the webview only as display material inside
   * a re-issued offer — never the other way round (worktree-provisioning.md
   * § 4.0; add-a-setup-step-for-this-create-only/design.md D1).
   */
  promptSetupStep?(current?: string): Promise<string | undefined>;
  copyText(text: string): Promise<void>;
  focusPane(paneId: string, viewId: string): Promise<void>;
  copyResumeCommand(entryId: string): Promise<void>;
  revealSessionCwd(entryId: string): Promise<void>;
  copySessionCwd(entryId: string): Promise<void>;

  // ── Launch (worktree-actions.md § 4) ─────────────────────────────────
  // These RESOLVE a launch; they do not spawn it. The pane belongs to the
  // surface, so the resolved options come back here and go out to it.
  /** A brand-new session for `agent`, in `cwd`. Rejects on anything it cannot admit. */
  startAgent?(
    agent: string,
    cwd: string,
    opts: { permissionChoiceId?: string; prompt?: string },
  ): Promise<CreateSessionOptions>;
  /** An existing session, run in `cwd` rather than the one it was recorded in. */
  resumeSessionAt?(entryId: string, cwd: string): Promise<CreateSessionOptions>;
  /**
   * The agents this host would advertise as able to start a fresh session, and
   * on what terms. The SAME answer the panel is given, asked again at the
   * action: a request carrying values the panel never offered — a stale list, a
   * forged message — is not admitted just because a launcher would run it.
   */
  launchTargets?(): Promise<readonly VaultLaunchTarget[]>;

  // ── Mutating (design.md D1, D12, D13) ────────────────────────────────
  // Optional, so a surface or a host wired without them offers nothing rather
  // than offering a control that resolves to no capability.
  /**
   * Remove a worktree. The capability owns the journal, the git invocation and
   * the indeterminate classification; the host's job is resolving WHICH
   * worktree and refusing to pass a force that carries no fingerprint.
   */
  /**
   * Create a worktree. The capability re-validates the path immediately before
   * spawning — after the coordinator's queue wait — because the host's check
   * here is only a shape check, not a filesystem one.
   */
  createWorktree?(request: {
    repoId: string;
    path: string;
    /** Unflattened all the way down: the capability reads the mode, never a field-presence guess. */
    mode: WorktreeCreateMode;
    disposition: DestinationDisposition;
    /** The launch details live on the `agent` variant; no other variant can carry them. */
    afterCreate: WorktreeAfterCreate;
    /**
     * Materials the host resolved from the offer it issued — explicit model
     * provenance today, never inferred from presentation fields, and never
     * anything the webview spelled (D2). Absent means provision nothing.
     */
    provision?: readonly ProvisionMaterial[];
    /** Ports resolved from the same host-held offer, kept separate from path-bearing entries. */
    ports?: readonly ProvisionPort[];
    migration?: {
      readonly sourcePath: string;
      readonly source: MigrationOfferEvidence["source"];
      readonly snapshot: MigrationOfferEvidence["snapshot"];
      readonly binding: MigrationRepositoryBinding;
    };
    /** Setup scripts resolved from the same host-held offer, never webview text. */
    setup?: readonly ProvisionSetupStep[];
    /** Whether an active asimov provider supplied the redeemed model. */
    asimovEnvironment?: boolean;
    origin?: WorktreeSurface;
  }): Promise<void>;
  /** Retry setup only for the current worktree identity and its rotating capability. */
  retrySetup?(target: WorktreeMutationTarget, retryId: string): Promise<void>;
  /** Reveal retained setup output only on the surface that originated the request. */
  viewSetupOutput?(outputId: string, origin: WorktreeSurface): Promise<void>;
  removeWorktree?(
    target: WorktreeMutationTarget,
    fingerprint: string | undefined,
    deleteBranch?: BranchDeleteRequest,
  ): Promise<void>;
  /**
   * What removing this worktree WOULD cost, without removing it.
   *
   * Answers in the wire's own shape, already carrying whatever authority the
   * report is worth. The host neither computes that authority nor converts the
   * assessment: both live beside `atRisk` and the check catalogue, and a copy
   * here would be a second opinion about a deletion (design.md D6, D7).
   *
   * `null` when the id names nothing, and the host then posts nothing.
   */
  assessRemovalReport?(target: WorktreeMutationTarget): Promise<WorktreeRemoveAssessmentMessage["result"] | null>;
  lockWorktree?(target: WorktreeMutationTarget, reason: string | undefined): Promise<void>;
  unlockWorktree?(target: WorktreeMutationTarget): Promise<void>;
  /**
   * `confirmedCount` is what the confirmation named. The capability re-counts
   * before running and abandons the prune when the answer moved, so the user
   * never authorizes one number and gets another.
   */
  pruneRepo?(repoId: string, confirmedCount: number, origin?: WorktreeSurface): Promise<void>;
  /**
   * Drop confirmations for worktrees that are no longer in the tree.
   *
   * Called after EVERY authoritative rebuild, not only after a removal: the
   * disappearance a confirmation dies on can be observed by any of them (D15).
   */
  reconcileFingerprints?(presentWorktreeIds: readonly string[]): void;
}

/**
 * WHICH worktree, unresolved.
 *
 * The read-only capabilities take a path the host looked up, because a reveal
 * or a copy acts immediately. A mutation does not: it waits for the queue and a
 * forced rebuild first, and a path resolved before that wait can name a
 * registration that no longer exists — or a different one that took its place.
 * Mutations therefore carry the id and resolve on the far side (round-1 B2).
 */
export interface WorktreeMutationTarget {
  repoId: string;
  worktreeId: string;
  /**
   * The surface that raised this action, so its outcome can go back there.
   * Not part of any message — the host supplies it from the routing it already
   * does in `handleMessage(surface, msg)` (D17).
   */
  origin?: WorktreeSurface;
}

/** The mutating half of `WorktreeActions`, as one suppliable unit. */
export type WorktreeMutationCapabilities = Required<
  Pick<
    WorktreeActions,
    "createWorktree" | "removeWorktree" | "lockWorktree" | "unlockWorktree" | "pruneRepo" | "reconcileFingerprints"
  >
>;
