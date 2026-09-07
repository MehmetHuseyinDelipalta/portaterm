// src/webview/worktree/controller/visibility.ts — Whether the panel is showing
// this body, what that subscribes to, and what a hide has to drop.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_2). The panel's request and the effective subscription
// derived from it are two different facts, and they were two fields 550 lines
// from the one method that keeps them in step.
//
// `setVisible` and `revalidateVisibility` stay on the class as facade methods —
// `main.ts` and two suites call them through the instance (D5).

import type { WebViewToExtensionMessage, WorktreeSubscriptionLevel } from "../../../types/messages";

export interface VisibilityDeps {
  postMessage(msg: WebViewToExtensionMessage): void;
  /**
   * Whether this surface still draws something from presence other than the
   * rail. Read through the controller's deps, which may not carry it at all.
   */
  presenceNeeded(): boolean | undefined;
  /** Drop the create this body was waiting to open. Owned by `createFlow`. */
  clearPendingCreate(): void;
  /** The forced refresh in flight, if any. Owned by `treeReconcile`. */
  refreshing(): boolean;
  abandonRefresh(): void;
  push(): void;
  /** The launch-target ask in flight, if any. Owned by `agentActions`. */
  awaitingLaunchTargets(): boolean;
  noteAwaitingLaunchTargets(): void;
}

export interface Visibility {
  /**
   * What the PANEL asked for: is the rail showing this body? Everything that
   * acts on the body keys on this falling to false, never on the subscription
   * ending — a scope can hold the subscription open long after the panel left
   * (design.md D4).
   */
  bodyShown(): boolean;

  /**
   * Declare whether this surface is showing the view, and ask for the tree on the
   * way in. The host sends nothing to a surface that has not declared it visible,
   * so this is what starts and stops the flow — nothing polls.
   */
  setVisible(visible: boolean): void;

  /**
   * Recompute the subscription from the panel's request and the current scope.
   * For the edge the panel cannot see: a scope set or cleared while the rail's
   * own state has not moved.
   */
  revalidateVisibility(): void;
}

export function createVisibility(deps: VisibilityDeps): Visibility {
  /**
   * The level last posted, or null while unsubscribed. The effective state, not
   * a request — `applySubscription` derives it.
   */
  let subscribed: WorktreeSubscriptionLevel | null = null;
  let bodyShown = false;

  function applySubscription(): void {
    // Two questions, two answers. The rail decides whether rows are drawn; a
    // scope decides whether anything is drawn from presence at all. Its chip,
    // escape control and hidden-waiting count all survive a collapsed rail
    // (worktree-panel-ui.md § 7.1), and going quiet under one freezes the
    // presence half of that count, which `tab-bar-component` § "The count reads
    // every source that can say a pane is waiting" forbids.
    const level: WorktreeSubscriptionLevel | null = bodyShown
      ? "rows"
      : deps.presenceNeeded() === true
        ? "presence"
        : null;
    if (level === subscribed) {
      return;
    }
    const wasSubscribed = subscribed !== null;
    subscribed = level;
    const visible = level !== null;
    deps.postMessage({ type: "worktreeViewVisibility", visible, ...(level ? { level } : {}) });
    if (visible) {
      // A level change on a standing subscription re-requests nothing. Promotion
      // does need the bare envelope redone, but asking for a tree only
      // rebroadcasts what is published — the host owns whether the published
      // envelope was enriched, and it re-projects on promotion itself
      // (round-2 W1).
      if (wasSubscribed) {
        return;
      }
      deps.postMessage({ type: "requestWorktreeTree" });
      // Asked on the way in rather than once at mount: which agents resolve is a
      // property of the machine, and one installed since the last look should
      // appear without reloading the window. One at a time, though — the reply
      // says which capability it answers and not which ASK, so two in flight can
      // land in either order and the older one would win.
      if (!deps.awaitingLaunchTargets()) {
        deps.noteAwaitingLaunchTargets();
        deps.postMessage({ type: "requestVaultLaunchTargets", capability: "start" });
      }
      return;
    }
    // A force in flight across this transition is never answered — the host skips
    // pushes to a surface that stopped showing the view.
    if (deps.refreshing()) {
      deps.abandonRefresh();
      deps.push();
    }
  }

  return {
    bodyShown: () => bodyShown,

    setVisible(visible) {
      if (visible !== bodyShown) {
        bodyShown = visible;
        if (!visible) {
          // A create resolved after the panel left this body would mount a form
          // over a body it does not act in (round-1 W6). Keyed on the PANEL's
          // request, not on the subscription: a scope keeps the subscription open,
          // and this cleanup has nothing to do with presence. Putting it behind the
          // effective value is exactly the regression the earlier attempt shipped
          // (collapse-the-rail-after-a-sidebar-selection/.reviews/round-1.md B2).
          deps.clearPendingCreate();
        }
      }
      applySubscription();
    },

    revalidateVisibility() {
      applySubscription();
    },
  };
}
