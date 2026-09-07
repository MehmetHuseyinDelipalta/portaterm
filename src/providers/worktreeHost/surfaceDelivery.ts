// src/providers/worktreeHost/surfaceDelivery.ts — What reaches an attached
// surface, and when it is honest to send it.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_12). The delivery gate, the edge that serves a surface
// which just began showing, and the rebuild whose single push both depend on
// sat in three places, so "who may receive a push" had three answers to keep
// in agreement.
//
// `built` came with the rebuild that is its only writer. `treeVersion` did
// not: the watch reconciler writes it too, so it stays in the composition root
// and this module bumps it through a dep.
//
// The rebuild gate is constructed FROM this module's `rebuild`, so the gate
// arrives back as an accessor — read when a message lands, which is always
// after construction.

import type {
  ExtensionToWebViewMessage,
  WebViewToExtensionMessage,
  WorktreeActionMessage,
  WorktreeSubscriptionLevel,
} from "../../types/messages";
import type { PresenceProjector } from "../../worktree/presenceProjector";
import type { WorktreePresence } from "../../worktree/presenceTypes";
import type { WorktreeCache } from "../../worktree/WorktreeCache";
import {
  buildWorktreeTreeDetailed,
  listRegisteredRepoWorktrees,
  type WorktreeTreeDeps,
} from "../../worktree/WorktreeDiscovery";
import type { WorktreeAttachment, WorktreeHostOptions } from "./hostOptions";
import type { WorktreeSurface } from "./hostTypes";
import type { Envelope } from "./projectionLoop";

/** The gate scope that rebuilds every repository; any other scope is a repoId. */
export const WHOLE_TREE_SCOPE = "*";

export interface SurfaceState {
  /**
   * False until the surface says otherwise. All three surfaces retain their DOM
   * while hidden, so a default of true would post into panels that have never
   * shown the view — the cost this gate exists to avoid.
   */
  visible: boolean;
  /**
   * The window is displaying this surface. Independent of `visible`, and false
   * for the same reason: `retainContextWhenHidden` means a surface that stopped
   * being displayed still holds — and still means — its last declaration.
   */
  displayed: boolean;
  /** Last computed `visible && displayed`, so the transition is edge-triggered. */
  showing: boolean;
  /**
   * What this surface draws from presence while subscribed. Only `"rows"` needs
   * per-row title and preview enrichment; a `"presence"` subscriber is drawing a
   * scope's chip, escape control and count, none of which read either.
   *
   * Meaningless while `visible` is false, and deliberately not reset there: a
   * surface that stops and restarts keeps its last declaration until it sends a
   * new one, exactly as `visible` and `displayed` already do.
   */
  level: WorktreeSubscriptionLevel;
}

export interface SurfaceDeliveryDeps {
  options: Pick<WorktreeHostOptions, "workspaceFolders" | "actions">;
  projector: PresenceProjector | undefined;
  cache: Pick<WorktreeCache, "read" | "applyBuild" | "applyRepo" | "rootFor">;
  /** The attached surfaces. Owned by the composition root, which also clears it. */
  surfaces: Map<WorktreeSurface, SurfaceState>;
  discoveryDeps: WorktreeTreeDeps;
  /** The envelope the projection loop last committed, and presence as it stands. */
  published(): Envelope | undefined;
  presence(): WorktreePresence;
  disposed(): boolean;
  /** The rebuild gate, read at call time: it is constructed FROM `rebuild`. */
  gate(): { request(scope: string, opts: { force?: boolean; signal?: boolean }): unknown };
  /** A cache write is a tree move; the root owns the counter (task 2_10). */
  bumpTreeVersion(): void;
  reconcileWatches(): void;
  forgetDepartedRepos(departed: ReadonlySet<string>): void;
  /** The projection loop (task 2_11). */
  worktreeIds(): string[];
  requestProjection(): Promise<void>;
  ensureProjection(): void;
  /** The per-surface state three other clusters drop when a surface detaches. */
  surfaceKey(surface: WorktreeSurface): string;
  forgetSurfaceOpenings(key: string): void;
  forgetSurfaceAssessments(key: string): void;
  reconcileScan(): void;
  reconcileRowDrawing(): void;
  /** The inbound router (task 2_9). */
  handleAction(surface: WorktreeSurface, msg: WorktreeActionMessage): void;
  requestDelegations(rowId: string, entryId: string): void;
  /** `console.warn` under the window's own log prefix. */
  logWarn(message: string, err: unknown): void;
}

export interface SurfaceDelivery {
  /** False until the first rebuild writes the cache. */
  built(): boolean;

  /** Is there anything honest to send? */
  deliverable(): boolean;

  /**
   * Post to one surface, containing a throw rather than abandoning the caller
   * mid-way. The delivery gate is deliberately NOT here (design.md D19).
   */
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;

  /** Publish the committed envelope to every surface that may receive a push. */
  broadcast(): void;

  /** One rebuild, then one push. Handed to the gate, never called directly. */
  rebuild(scope: string): Promise<void>;

  attach(surface: WorktreeSurface): WorktreeAttachment;

  handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void;
}

/** The one fact this module writes, so its writer can be a plain function. */
interface DeliveryFlags {
  /** False until the first rebuild writes the cache. Written only by `rebuild`. */
  built: boolean;
}

/**
 * Is there anything honest to send?
 *
 * `built` turns true when the first rebuild writes the cache, which is before
 * its projection can have committed. Delivering in that window paired the
 * live tree with a synthetic empty presence — every agent row missing, then
 * appearing a moment later (.reviews/round-3.md B1). A host with no projector
 * has no second half to wait for, so it is deliverable from its first build.
 */
function deliverable(deps: SurfaceDeliveryDeps): boolean {
  return deps.published() !== undefined || !deps.projector;
}

function currentMessage(deps: SurfaceDeliveryDeps): ExtensionToWebViewMessage {
  // Never the live cache: an uncommitted tree has no presence to pair with.
  const envelope = deps.published() ?? { tree: deps.cache.read(), presence: deps.presence() };
  return { type: "worktreeTreeResponse", tree: envelope.tree, presence: envelope.presence };
}

/**
 * Deliver to one surface, or skip it. The gate lives here alone so a broadcast
 * and a single-surface delivery cannot come to different answers about who may
 * receive a push.
 */
function postTo(
  deps: SurfaceDeliveryDeps,
  surface: WorktreeSurface,
  state: SurfaceState,
  message: ExtensionToWebViewMessage,
): boolean {
  if (!state.visible || !state.displayed || !surface.isReady()) {
    return false;
  }
  return deliver(deps, surface, message);
}

/**
 * Post to one surface, containing a throw rather than abandoning the caller
 * mid-way.
 *
 * The delivery gate is deliberately NOT here: a broadcast skips a surface that
 * cannot receive a push, but an answer to a form the user has open is not a
 * push, and applying the gate to it would drop the reply the form is waiting
 * for. `postTo` adds the gate for the broadcast case (design.md D19).
 *
 * A dropped offer is not stranded: the offer store has already re-minted the
 * id, so the form's next save names an id the host no longer knows and is
 * answered with a fresh offer.
 */
function deliver(deps: SurfaceDeliveryDeps, surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean {
  try {
    surface.post(message);
    return true;
  } catch (err) {
    deps.logWarn("surface post threw — continuing", err);
    return false;
  }
}

function broadcast(deps: SurfaceDeliveryDeps): void {
  if (deps.disposed() || !deliverable(deps)) {
    return;
  }
  const message = currentMessage(deps);
  for (const [surface, state] of deps.surfaces) {
    postTo(deps, surface, state, message);
  }
}

/**
 * Serve a surface that has just begun showing the view. Edge-triggered on both
 * facts together, so a repeated report from either one is a no-op, and served
 * from the cache: the watches ran while the surface was away, so a rebuild
 * would re-read git for what is already held — and would push it to everyone.
 *
 * `serveOnRise` is false for the webview's own declaration, which arrives with
 * a tree request behind it — serving that edge as well would post twice. The
 * window displaying a surface again is the edge with no requester, which is
 * the gap this exists to close.
 */
function reconcileShowing(
  deps: SurfaceDeliveryDeps,
  flags: DeliveryFlags,
  surface: WorktreeSurface,
  state: SurfaceState,
  serveOnRise: boolean,
): void {
  const showing = state.visible && state.displayed;
  if (showing === state.showing) {
    return;
  }
  if (!showing) {
    state.showing = false;
    return;
  }
  if (deps.disposed() || !serveOnRise) {
    state.showing = true;
    return;
  }
  if (!flags.built) {
    // Nothing to serve yet; the build's own broadcast reaches this surface.
    state.showing = true;
    void deps.gate().request(WHOLE_TREE_SCOPE, {});
    return;
  }
  if (!deliverable(deps)) {
    // Built, but the first projection has not committed. The commit
    // broadcasts to every showing surface, and this one now is.
    state.showing = true;
    return;
  }
  // Recorded only once it actually reached the surface. A post that was
  // skipped as not-ready, or that threw, must not consume the edge — the next
  // report would find nothing to do and the surface would stay stale.
  state.showing = postTo(deps, surface, state, currentMessage(deps));
}

/**
 * One rebuild, then one push. Broadcasting from inside the gate's run — not
 * from each caller after awaiting — is what makes two concurrent requests
 * produce a single push rather than one each.
 */
async function rebuild(deps: SurfaceDeliveryDeps, flags: DeliveryFlags, scope: string): Promise<void> {
  if (deps.disposed()) {
    return;
  }
  if (scope === WHOLE_TREE_SCOPE) {
    const before = new Set(deps.cache.read().repos.map((repo) => repo.repoId));
    deps.cache.applyBuild(await buildWorktreeTreeDetailed(deps.options.workspaceFolders(), deps.discoveryDeps));
    flags.built = true;
    deps.bumpTreeVersion();
    deps.reconcileWatches();
    const live = new Set(deps.cache.read().repos.map((repo) => repo.repoId));
    deps.forgetDepartedRepos(new Set([...before].filter((repoId) => !live.has(repoId))));
  } else {
    const root = deps.cache.rootFor(scope);
    if (root) {
      deps.cache.applyRepo(scope, await listRegisteredRepoWorktrees(root, deps.discoveryDeps), deps.discoveryDeps.rank);
      deps.bumpTreeVersion();
    }
  }
  // Every authoritative rebuild is an observation of what still exists, and
  // D15 turns a confirmation off on exactly that observation. Doing it only
  // in the removal path left a token alive for a worktree deleted any other
  // way — by another window, or by hand (round-3 B5).
  deps.options.actions?.reconcileFingerprints?.(deps.worktreeIds());
  // The coordinator commits the envelope and publishes it — once.
  await deps.requestProjection();
}

function attach(deps: SurfaceDeliveryDeps, flags: DeliveryFlags, surface: WorktreeSurface): WorktreeAttachment {
  deps.surfaces.set(surface, { visible: false, displayed: false, showing: false, level: "rows" });
  return {
    dispose: () => {
      deps.surfaces.delete(surface);
      // The models this surface was shown go with it, and so does the
      // opening that was shown them. Nothing else evicts either, so without
      // this the store grows with every window ever opened, a stale id stays
      // resolvable (.reviews/round-1.md B6), and the opening record outlives
      // the window that held it (round-1 W1).
      // A detached surface's openings can never be answered, and their
      // enumerations would otherwise be retained for the life of the host.
      // One routine for all three lifecycles now, so a channel added to
      // retirement cannot reach close and miss detach.
      deps.forgetSurfaceOpenings(deps.surfaceKey(surface));
      // The assessments it was still owed go with it too. Kept beside rather
      // than inside `forgetSurfaceOpenings`: that routine is the create
      // form's three lifecycles, and a create form closing must not retire a
      // removal assessment the user is waiting on.
      //
      // PROMPTNESS, not correctness, and deliberately not dressed as more:
      // `pending` is non-empty only while a job is outstanding, and
      // `takeNextAssess` already drops the entry of a departed surface, so
      // removing this line changes no assertion in the suite. What it buys is
      // releasing the surface reference now rather than holding it across an
      // assessment that can run for the length of a git status timeout.
      deps.forgetSurfaceAssessments(deps.surfaceKey(surface));
      // Detaching is a falling edge too: the last showing surface going away
      // this way would otherwise leave the scan armed for the window's life,
      // and the last ROW-DRAWING surface would leave a turn order standing
      // over identities nothing is drawing (design.md D10).
      deps.reconcileScan();
      deps.reconcileRowDrawing();
    },
    setDisplayed: (displayed: boolean) => {
      const state = deps.surfaces.get(surface);
      if (state) {
        state.displayed = displayed;
        reconcileShowing(deps, flags, surface, state, true);
        deps.reconcileScan();
        deps.reconcileRowDrawing();
      }
    },
  };
}

function handleMessage(
  deps: SurfaceDeliveryDeps,
  flags: DeliveryFlags,
  surface: WorktreeSurface,
  msg: WebViewToExtensionMessage,
): void {
  const state = deps.surfaces.get(surface);
  if (deps.disposed() || !state) {
    return;
  }
  switch (msg.type) {
    case "worktreeViewVisibility": {
      state.visible = msg.visible;
      // Absent means `"rows"`: the field is additive and a sender that predates
      // it is declaring what it always declared.
      state.level = msg.level ?? "rows";
      reconcileShowing(deps, flags, surface, state, false);
      deps.reconcileScan();
      deps.reconcileRowDrawing();
      return;
    }
    case "requestWorktreeSubagents":
      deps.requestDelegations(msg.rowId, msg.entryId);
      return;
    case "worktreeOpenFolder":
    case "worktreeRevealInOS":
    case "worktreeCopyPath":
    case "worktreeOpenTerminal":
    case "worktreeFocusPane":
    case "worktreeOpenPreview":
    case "worktreeCopyResumeCommand":
    case "worktreeRevealAgentCwd":
    case "worktreeCopyAgentPath":
    case "worktreeLaunchAgent":
    case "worktreeResumeHere":
    case "worktreeCreate":
    case "worktreeRemove":
    case "worktreeRemoveAssess":
    case "worktreeLock":
    case "worktreeUnlock":
    case "worktreePrune":
    case "requestWorktreeCreateDefaults":
    case "worktreeCreateClosed":
    case "worktreeProvisionSwitch":
    case "worktreeProvisionSave":
    case "worktreeCopyFileAsk":
    case "worktreeSetupStepAsk":
    case "worktreeSetupRetry":
    case "worktreeSetupViewOutput":
    case "requestWorktreeRefs":
    case "worktreeCreateProbe":
    case "worktreePickDestination":
    case "worktreeAuthorizeDebris":
      deps.handleAction(surface, msg);
      return;
    case "requestWorktreeTree":
      // Nothing to serve before the first build, whatever the caller asked for.
      if (msg.force === true || !flags.built) {
        void deps.gate().request(WHOLE_TREE_SCOPE, { force: msg.force === true });
        return;
      }
      if (!deliverable(deps)) {
        // Built but never committed — wait for the missing half rather than
        // answering with a tree whose presence does not exist yet.
        deps.ensureProjection();
        return;
      }
      broadcast(deps);
      return;
    default:
      return;
  }
}

export function createSurfaceDelivery(deps: SurfaceDeliveryDeps): SurfaceDelivery {
  const flags: DeliveryFlags = { built: false };

  return {
    built: () => flags.built,
    deliverable: () => deliverable(deps),
    deliver: (surface, message) => deliver(deps, surface, message),
    broadcast: () => {
      broadcast(deps);
    },
    rebuild: (scope) => rebuild(deps, flags, scope),
    attach: (surface) => attach(deps, flags, surface),
    handleMessage: (surface, msg) => {
      handleMessage(deps, flags, surface, msg);
    },
  };
}
