// src/webview/worktree/controller/controllerTypes.ts — What the Worktree
// controller is handed, and the persisted-state seam it reads and writes.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_1). The contract sat above the class that implements
// it, so a collaborator taking part of that contract could not name it without
// importing the whole class.
//
// The TYPES move; the `deps` FIELD does not (D5) — five suites reach the
// controller and the view through their instances, and the object graph is the
// contract.

import type { WebViewToExtensionMessage } from "../../../types/messages";
import type { TerminalOwner } from "../../navigation/TerminalNavigationState";
import type { PaneReport } from "../../paneAttribution";
import type { WebviewState } from "../../state/WebviewState";
import type { WorktreeRowActivation } from "../worktreeViewTypes";

/** The persisted-state reads and writes the view's two disclosure levels need. */
export interface WorktreeStateStore {
  getState(): WebviewState;
  updateState(patch: Partial<WebviewState>): void;
}

export interface WorktreeControllerDeps {
  /** Panel element dialogs and menus would position within. */
  host: HTMLElement;
  postMessage(msg: WebViewToExtensionMessage): void;
  store: WorktreeStateStore;
  /** Init fields this controller boots from. */
  init: { workspaceRoot: string | null; rowActivation: WorktreeRowActivation };
  /**
   * The user selected a worktree, or `null` when the selected one left the tree.
   * The scope consumer subscribes here; the controller only relays and holds.
   */
  onSelectWorktree?: (worktreeId: string | null) => void;
  /** Current committed terminal owner, read only for row projection. */
  activeOwner?: () => TerminalOwner;
  /**
   * Which worktree each of this window's panes is running in. Emitted on every
   * push whose attribution moved, and never otherwise.
   */
  onAttribution?: (report: PaneReport) => void;
  /**
   * Whether this surface still draws something from presence other than the rail
   * — a scope's chip, its escape control and its hidden-waiting count all
   * outlive a collapsed rail. Absent → the rail alone decides.
   */
  presenceNeeded?: () => boolean;
  /**
   * Open the session-preview overlay for a host-resolved entry. Returns false
   * when this surface holds no such entry — the host resolved against presence,
   * which can name a session this webview's own list does not have.
   */
  showPreview?(entryId: string): boolean;
  /** Activate a pane this surface holds. False when it holds no such pane. */
  activatePane?(paneId: string): boolean;
  /**
   * Whether the tree holds any repository a create could act in. Reported on
   * every tree, because the toolbar control it gates must be absent — not
   * present and inert — when there is nothing to create in.
   */
  onCreateAvailability?(available: boolean): void;
  /** Injected in tests so ages are deterministic. */
  now?(): number;
}
