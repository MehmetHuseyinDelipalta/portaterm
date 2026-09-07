// src/providers/worktreeHost/hostOptions.ts — What a worktree host is
// CONSTRUCTED with and what it OFFERS, with none of the machinery that honours
// either.
//
// Extracted from `src/providers/WorktreeHost.ts` by change
// `decompose-worktree-host` (design.md D1, task 2_1). The contract sat in the
// same module as the 2200-line closure implementing it, so reading what a host
// promises meant scrolling past how it keeps the promise.
//
// Every name here is re-exported from `src/providers/WorktreeHost.ts`, so no
// importer moved when the declarations did (D4).

import type * as vscode from "vscode";
import type {
  ProvisionModel,
  ProvisionPort,
  ProvisionProvider,
  WebViewToExtensionMessage,
  WorktreeProvisionResultMessage,
} from "../../types/messages";
import type { ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import type { AdoptVerdict } from "../../worktree/adoptProbe";
import type { DebrisIssueResult } from "../../worktree/debrisAuthorization";
import type { GitEntryProbe } from "../../worktree/debrisClassification";
import type { IgnoredMaterial } from "../../worktree/ignoredMaterial";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../../worktree/migrateChanges";
import type { OrphanProofs } from "../../worktree/orphanProofs";
import type { PresenceProjector } from "../../worktree/presenceProjector";
import type { DelegationRoster } from "../../worktree/presenceTypes";
import type { NativeConfigDivergence, NativeConfigWrite } from "../../worktree/provisioning/writeNativeConfig";
import type { ReattachVerdict } from "../../worktree/reattachProbe";
import type { RebuildGateClock } from "../../worktree/rebuildGate";
import type { PullRequestsInput, PullRequestsRead } from "../../worktree/repoPullRequests";
import type { RepoRefsInput, RepoRefsRead } from "../../worktree/repoRefs";
import type { WorktreeTreeDeps } from "../../worktree/WorktreeDiscovery";
import type { PaneFact, SessionRead, SourceRead } from "../../worktree/worktreeBlockers";
import type { WatcherPool } from "../fsWatcherPool";
import type { WorktreeActions, WorktreeSurface } from "./hostTypes";
import type { WorktreeMutationBindings, WorktreeMutationReport } from "./mutationBindings";

export interface WorktreeHostOptions {
  deps: WorktreeTreeDeps;
  /** Read at rebuild time, not captured: folders change while the window lives. */
  workspaceFolders(): readonly string[];
  pool: Pick<WatcherPool, "subscribePattern">;
  /** `vscode.workspace.onDidChangeWorkspaceFolders`, injected for testability. */
  onDidChangeWorkspaceFolders?(listener: () => void): vscode.Disposable;
  clock?: RebuildGateClock;
  /** `anywhereTerminal.worktree.createRoot`, read through `SettingsReader`. */
  createRoot?(): { value: string | undefined; explicitlySet: boolean };
  /** Prove that one exact source can currently be migrated. */
  probeMigrationSource?(
    sourcePath: string,
    binding: MigrationRepositoryBinding,
  ): Promise<MigrationOfferEvidence | undefined>;
  /** Cryptographically random in production; deterministic only in tests. */
  migrationOfferId?(): string;
  /**
   * The two evidence sources a removal assessment needs and the tree does not
   * carry. Absent in the tests that only exercise routing; supplied in
   * production from the same store and registry the projector reads, so the
   * blockers a confirmation is bound to come from one set of facts.
   */
  removalFacts?: {
    /** Async because the cwds carry the resolution `PaneFact.cwd` promises. */
    panes(): Promise<readonly PaneFact[]>;
    /** Every registry record, live or not — `evaluateRemoval` applies the live filter. */
    sessions(): Promise<SourceRead<SessionRead>>;
    /**
     * The three proofs of worktree-removal.md § 4.
     *
     * Takes the registry read already in flight rather than issuing its own —
     * the ownership proof is about the records that read returns, and a second
     * scan of the same directory could disagree with the first about the same
     * instant (design.md D3).
     */
    proofs(
      subject: { path: string; locked: boolean; branch?: string },
      sessions: Promise<SourceRead<SessionRead>>,
    ): Promise<OrphanProofs>;
    /**
     * One bounded walk of what the removal will delete that git does not track.
     *
     * Takes the worktree's own path because the walk is per worktree, and
     * answers its own unproven rather than throwing: a slow or unreadable disk
     * leaves one confirmable check unproven, never a refusal
     * (worktree-removal.md § 2.3).
     */
    ignored(worktreePath: string): Promise<IgnoredMaterial>;
    /**
     * Registry identities a pane of this window claimed, mapped to that pane.
     *
     * Read alongside the panes rather than before or after them, so the claim
     * and the snapshot it is corroborated against come from one moment
     * (design.md D6, cycle-2 B5).
     */
    claimedByPane(): Promise<ReadonlyMap<string, string>>;
  };
  /**
   * The window projection. Absent — every surface but the real extension entry
   * point — and the host behaves exactly as it did before presence existed.
   */
  projector?: PresenceProjector;
  /** Pane evidence moved. Injected as a subscription so the host owns no store. */
  onPaneChange?(listener: () => void): vscode.Disposable;
  now?(): number;
  /** Path-existence probe behind `initPayload`, injected in tests. */
  exists?(p: string): boolean;
  /**
   * Whether a `.git` ENTRY is there, without resolving it — what separates
   * debris from a checkout (design.md D1). Production leaves it absent and
   * takes `node:fs`; `exists` is not reused because it follows symlinks.
   */
  probeGitEntry?: GitEntryProbe;
  /**
   * Issue a clearance authorization for this path, or say which question
   * failed. Supplied by the mutation assembly, which owns the store the create
   * later redeems against (design.md D6).
   */
  issueDebrisAuthorization?(path: string): Promise<DebrisIssueResult>;
  /**
   * The filesystem the RESOLVED containment check reads. Must answer for the
   * same tree `exists` does — that check is what authorizes `exists`, so a
   * containment answer from a different filesystem authorizes nothing
   * (round-3 B8). Production leaves it absent and takes `node:fs`.
   */
  resolvedPathDeps?: ResolvedPathInsideDeps;
  /**
   * Read one session's delegation roster. Absent — every surface but the real
   * extension entry point — and an expansion request is ignored, exactly as it
   * was before delegations existed.
   *
   * Returns the outcome rather than a transcript: what a null read means is the
   * reader's to name, and a throw is turned into `failed` here.
   */
  readDelegations?(entryId: string): Promise<DelegationRoster>;
  /**
   * What the host cannot do itself. Absent — every surface but the real
   * extension entry point — and every action request is ignored, exactly as it
   * was before actions existed.
   *
   * The host resolves; these perform. Nothing here takes an id: each receives
   * the value the host looked up, so a capability cannot be handed a target the
   * host never validated (design.md D2).
   */
  actions?: WorktreeActions;
  /**
   * Read a repository's provisioning model. Absent — every surface but the real
   * extension entry point — and the create form gets no offer, exactly as it
   * behaved before provisioning existed.
   *
   * Takes the repo's main worktree path, because a provider file belongs to the
   * checkout that declares it, not to the worktree being made from it.
   */
  readProvisioning?(mainWorktree: string, prefer?: ProvisionProvider["id"]): Promise<ProvisionModel>;
  /** Best-effort numeric previews, computed from the current sibling paths before each offer is issued. */
  previewProvisioningPorts?(
    ports: readonly ProvisionPort[],
    worktreePaths: readonly string[],
  ): Promise<readonly ProvisionPort[]>;
  /**
   * Record the user's choice in the repository's OWN provisioning file, and in
   * no other (worktree-provisioning.md § 6). Absent on every surface but the
   * real extension entry point, and the form simply offers no save.
   *
   * Takes the same main-worktree path `readProvisioning` does, and a divergence
   * the host derived — never a path, key or text the webview sent.
   */
  writeNativeConfig?(mainWorktree: string, divergence: NativeConfigDivergence): Promise<NativeConfigWrite>;
  /**
   * Enumerate a repository's local branches. Absent — every surface but the
   * real extension entry point — and the create form gets no list, exactly as
   * it behaved before this existed.
   *
   * Takes the listing rather than fetching one: held-by is derived from the
   * worktrees the host already has, and a second read of the same repository
   * invites two answers about one instant (offer-every-ref-in-one-box D2).
   */
  readRefs?(input: RepoRefsInput): Promise<RepoRefsRead>;
  /**
   * The repository's open pull requests (offer-a-pull-request-as-a-source D3).
   *
   * Absent — every surface but the real extension entry point — and the form is
   * simply never told, which renders as the same unavailable row a forge that
   * could not answer produces. Deliberately NOT folded into `readRefs`: this one
   * is a network call, and § 4.1 requires the local list not to wait for it.
   */
  readPullRequests?(input: PullRequestsInput): Promise<PullRequestsRead>;
  /**
   * Corroborate a stale registration before a repair is offered (design.md D3).
   *
   * Absent — every surface but the real extension entry point — and a prunable
   * holder resolves to `reuse` at the free path rather than to a repair offer,
   * which is the same fail-closed the verdict's own `declined` produces.
   *
   * Takes the branch NAME rather than its tip: resolving `refs/heads/<branch>`
   * is a git read, and the host holds a listing, not a ref database.
   */
  probeReattach?(input: { repoPath: string; branch: string; repairPath: string }): Promise<ReattachVerdict>;
  /**
   * Whether the destination's occupied candidate is a checkout git has
   * forgotten — the adopt state `probeReattach` cannot reach, because git has
   * no registration left to downgrade (design.md D3).
   *
   * Absent, as with `probeReattach`, means the candidate stays occupied and the
   * suffixed free path stands. That is the same fail-closed a `declined`
   * verdict produces.
   */
  probeAdopt?(input: { candidatePath: string; commonDir: string }): Promise<AdoptVerdict>;
  /**
   * Whether the reconstruction has been executed and recorded on this platform.
   *
   * A defaulted parameter rather than a bare `process.platform` read at the call
   * site, so BOTH arms are witnessable from either platform — the shape
   * `readFlags` uses in `src/utils/regularFileRead.ts`.
   *
   * Default `process.platform !== "win32"`: the recipe writes into git's own
   * administrative directory, and WT-012.14 ran it on both platforms. It works
   * on darwin (git 2.50.1, 11 of 11) and FAILS on Windows (git 2.55.0.windows.5,
   * 3 of 11) — so adopt is withheld there as failing, which is now a claim
   * somebody has established, and no longer merely as unverified (design.md D7).
   *
   * The cause is a defect in the recipe, not a limit of the platform: git spells
   * the administrative paths with `/` on Windows too, the recipe spelled them
   * with `path.sep`, and `git worktree repair` neither accepts that form nor
   * normalises it. Spelling every recorded path with `/` on every platform is
   * what has to land — and the harness has to re-run green there — before this
   * default can flip. See `docs/design/worktree-create.md` § 2.4.
   */
  adoptSupported?: boolean;
  /**
   * The commit a base ref names, or `undefined` when it names none (D7).
   *
   * Host-side because the webview has no ref database, and answered on the
   * resolution because the resolver is already holding this repository's refs.
   */
  resolveBase?(input: { repoPath: string; ref: string }): Promise<string | undefined>;
  /**
   * Does git accept this as a branch name? `null` means git could not be asked,
   * which is not a refusal — the rules are never decided here.
   */
  acceptsBranchName?(input: { repoPath: string; branch: string }): Promise<boolean | null>;
}

/**
 * Init-message fields the worktree host contributes. Providers spread this into
 * their `init` payload so the panel can pick its opening view before it paints —
 * the host pushes nothing to a surface that has not declared the view visible,
 * so a webview that opened on the wrong body could never learn it had.
 */
export interface WorktreeInitPayload {
  /** At least one workspace folder is inside a git repository. */
  worktreeHasRepo: boolean;
}

/**
 * What `attach` hands back. Carrying the display-state setter here rather than
 * exposing it on the host keyed by surface is what stops a provider reporting
 * for a surface it never attached, or one whose attachment it already disposed.
 */
export interface WorktreeAttachment extends vscode.Disposable {
  /** Report whether the window is displaying this surface (design.md D1). */
  setDisplayed(displayed: boolean): void;
}

export interface WorktreeHost extends vscode.Disposable {
  /** Fields this host contributes to a surface's `init` message. */
  initPayload(): WorktreeInitPayload;
  /** The narrow read surface a mutation service is built on (round-1 B1). */
  mutationBindings(): WorktreeMutationBindings;
  /**
   * How many create-dialog openings this host is holding state for.
   *
   * The witness for a growth bound that has no other signature: a retained
   * opening answers nothing once its repository is gone, so nothing observable
   * distinguishes retaining one from releasing it, and an assertion written
   * against messages alone could not fail (round-4 B7).
   */
  openingsHeld(): number;
  /**
   * Deliver a mutation outcome to the surface that started it, and open a
   * terminal there when the create asked for one.
   *
   * The service used to post straight at two providers, which missed every
   * attached editor surface and could not open a terminal at all — that needs a
   * view id and a webview, which only a surface holds (D17, D2).
   */
  reportMutation(outcome: WorktreeMutationReport): void;
  /** Deliver a setup-only retry update without replaying a mutation outcome. */
  reportProvisioning?(origin: WorktreeSurface | null, outcome: WorktreeProvisionResultMessage): void;
  /** Register one surface. Disposing detaches only that surface. */
  attach(surface: WorktreeSurface): WorktreeAttachment;
  /** Route an inbound worktree message from `surface`. Unknown types ignored. */
  handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void;
  /**
   * Answer "which agents can start a fresh session here" for `surface`, and
   * remember the answer.
   *
   * The host answers rather than merely supplying the capability, because the
   * admission door has to check the set this surface was OFFERED. Two
   * independent probes are two answers with a window between them: an agent
   * installed after the panel was answered would pass the second one having
   * never appeared in the first.
   */
  publishLaunchTargets(surface: WorktreeSurface): Promise<void>;
}
