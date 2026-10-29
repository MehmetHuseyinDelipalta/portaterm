// src/webview/broadcastInput.ts — Broadcast input: one keystroke, every pane of a tab.
//
// A tab is broadcasting when the user turned it on AND its layout is split.
// While it is, input the user types into any of its panes is posted to every
// live pane of that tab instead of only the one with focus — the tmux
// `synchronize-panes` / iTerm "broadcast input" model.
//
// Only typed input goes through `send`. Replies xterm generates on its own
// (cursor-position reports, device attributes, focus and mouse reports) answer
// one program's query and stay with the pane that was asked: mirrored, they
// would land in the other panes' shells as stray keystrokes. Telling the two
// apart is `userInputSignal.ts`'s job; this module only fans out.
//
// The flag lives here and nowhere else: it is not persisted, so a reload never
// resumes a broadcast the user cannot see they left on.

import { getAllSessionIds, type SplitNode, tabOwningPane } from "./SplitModel";

/** The slice of the webview store this module reads. */
export interface BroadcastInputStore {
  readonly tabLayouts: ReadonlyMap<string, SplitNode>;
  readonly terminals: ReadonlyMap<string, { exited: boolean }>;
}

export interface BroadcastInputDeps {
  store: BroadcastInputStore;
  postMessage: (msg: unknown) => void;
}

/** Why `set` declined, so the caller can tell the user instead of doing nothing. */
export type BroadcastSetResult =
  | { kind: "changed"; tabId: string; enabled: boolean }
  | { kind: "unchanged"; tabId: string; enabled: boolean }
  | { kind: "unknown-pane" }
  | { kind: "single-pane"; tabId: string };

export class BroadcastInput {
  private readonly store: BroadcastInputStore;
  private readonly postMessage: (msg: unknown) => void;
  private readonly enabledTabs = new Set<string>();

  constructor(deps: BroadcastInputDeps) {
    this.store = deps.store;
    this.postMessage = deps.postMessage;
  }

  /** Whether typing in `tabId` currently reaches all of its panes. */
  isBroadcasting(tabId: string): boolean {
    return this.enabledTabs.has(tabId) && this.store.tabLayouts.get(tabId)?.type === "branch";
  }

  /** Every tab whose input is currently mirrored — for the tab bar's mark. */
  broadcastingTabIds(): ReadonlySet<string> {
    return new Set([...this.enabledTabs].filter((tabId) => this.isBroadcasting(tabId)));
  }

  /**
   * Turn broadcasting on or off for the tab holding `paneSessionId`; omit
   * `enabled` to toggle. Enabling a tab with a single pane is refused rather
   * than recorded: a flag that silently starts mirroring at some later split
   * is exactly the surprise this feature must not spring.
   */
  set(paneSessionId: string, enabled?: boolean): BroadcastSetResult {
    const tabId = tabOwningPane(this.store.tabLayouts, paneSessionId);
    if (!tabId) {
      return { kind: "unknown-pane" };
    }
    const current = this.isBroadcasting(tabId);
    const next = enabled ?? !current;
    if (next === current) {
      return { kind: "unchanged", tabId, enabled: current };
    }
    if (next && this.store.tabLayouts.get(tabId)?.type !== "branch") {
      return { kind: "single-pane", tabId };
    }
    if (next) {
      this.enabledTabs.add(tabId);
    } else {
      this.enabledTabs.delete(tabId);
    }
    return { kind: "changed", tabId, enabled: next };
  }

  /**
   * Forget tabs that closed or collapsed back to one pane. Collapsing ends the
   * broadcast for good — splitting again starts a fresh, unmirrored tab.
   * Returns whether anything was dropped.
   */
  prune(): boolean {
    let dropped = false;
    for (const tabId of this.enabledTabs) {
      if (this.store.tabLayouts.get(tabId)?.type !== "branch") {
        this.enabledTabs.delete(tabId);
        dropped = true;
      }
    }
    return dropped;
  }

  /**
   * Post input the user typed into `sessionId`. The source pane always gets
   * it — exactly as without broadcasting — and, when its tab is broadcasting,
   * so does every other pane of the tab that is still running.
   */
  send(sessionId: string, data: string): void {
    this.postMessage({ type: "input", tabId: sessionId, data });
    const tabId = tabOwningPane(this.store.tabLayouts, sessionId);
    if (!tabId || !this.isBroadcasting(tabId)) {
      return;
    }
    const layout = this.store.tabLayouts.get(tabId);
    if (!layout) {
      return;
    }
    for (const paneId of getAllSessionIds(layout)) {
      if (paneId === sessionId) {
        continue;
      }
      const instance = this.store.terminals.get(paneId);
      if (!instance || instance.exited) {
        continue;
      }
      this.postMessage({ type: "input", tabId: paneId, data });
    }
  }
}

/** What the webview does after a broadcast command, injected so the choice is testable. */
export interface BroadcastCommandEffects {
  /** Redraw the tab's pane frame, menu keys and tab-bar mark. */
  refresh(tabId: string): void;
  /** Tell the user why nothing happened. */
  notify(message: string): void;
}

export const SINGLE_PANE_NOTICE = "Broadcast input needs at least two panes — split this terminal first.";

/** Apply a host `setBroadcastInput` command and show its outcome. */
export function applyBroadcastCommand(
  broadcast: BroadcastInput,
  msg: { sessionId: string; enabled?: boolean },
  effects: BroadcastCommandEffects,
): void {
  const result = broadcast.set(msg.sessionId, msg.enabled);
  if (result.kind === "single-pane") {
    effects.notify(SINGLE_PANE_NOTICE);
  } else if (result.kind === "changed") {
    effects.refresh(result.tabId);
  }
}
