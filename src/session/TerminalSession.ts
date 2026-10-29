// src/session/TerminalSession.ts — Data shape for a single terminal session.
//
// Extracted from SessionManager.ts so the snapshot-persistence collaborator can
// import the type without creating a circular dependency.

import type { PtySession } from "../pty/PtySession";
import type { TabColorId, TabIconId } from "../shared/tabAppearance";
import type { MessageSender, OutputBuffer } from "./OutputBuffer";
import type { CommandTracker } from "./TrackedCommand";

/**
 * Minimal subset of `@xterm/headless` Terminal used by SnapshotPersistence.
 * Declared locally so tests can inject a fake without loading xterm-headless.
 */
export interface HeadlessTerminalLike {
  write(data: string, callback?: () => void): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
  loadAddon(addon: unknown): void;
  readonly cols: number;
  readonly rows: number;
}

export type HeadlessFactory = (cols: number, rows: number) => HeadlessTerminalLike;

/** Minimal subset of `@xterm/addon-serialize` SerializeAddon used by SnapshotPersistence. */
export interface SerializeAddonLike {
  serialize(options?: { scrollback?: number; excludeAltBuffer?: boolean; excludeModes?: boolean }): string;
  dispose(): void;
}

export type SerializeAddonFactory = () => SerializeAddonLike;

/**
 * Per-session lifecycle state — drives every snapshot-touching dispatch in
 * SessionManager (dispose, cleanupSession, pty.onExit) so the bug-shape of
 * round-4/round-5 (cross-method temporal coupling via implicit set-membership)
 * cannot recur. See design.md D14.
 *
 * Transitions:
 *   live              → destroying        (destroySession / destroyAllForView)
 *   live              → exited-preserved  (pty.onExit, not killed by user)
 *   exited-preserved  → destroying        (user destroys an already-exited restored tab)
 *   destroying        → disposed          (cleanupSession completes — tombstone before map deletion)
 *   exited-preserved  → disposed          (cleanupSession after natural exit — tombstone)
 */
export type SessionState = "live" | "exited-preserved" | "destroying" | "disposed";

/** A single terminal session with its PTY, buffer, and metadata. */
export interface TerminalSession {
  /** Unique session identifier (UUID) */
  id: string;
  /** Current lifecycle state — see SessionState union above. */
  state: SessionState;
  /** Which view this session belongs to (e.g., 'portaterm.sidebar') */
  viewId: string;
  /** The PTY process wrapper */
  pty: PtySession;
  /** Display name: "Terminal 1", "Terminal 2", etc. */
  name: string;
  /**
   * User-supplied display name. When non-null, takes priority over `name` in
   * the tab label. Reset to null by submitting an empty rename. Hydrated from
   * workspaceState on create for non-split-pane sessions (see add-tab-rename design.md D3).
   */
  customName: string | null;
  /**
   * Pinned root tab: listed first in the tab bar and refused by the close-tab
   * door until unpinned. Persisted in the session snapshot; absent means not
   * pinned (and always absent on split panes).
   */
  pinned?: boolean;
  /**
   * The root tab's color and icon, chosen from the tab's context menu. Persisted
   * in the session snapshot; absent means none (and always absent on split panes).
   */
  tabColor?: TabColorId;
  tabIcon?: TabIconId;
  /** Whether this is the active tab in its view */
  isActive: boolean;
  /** Assigned terminal number (for name and recycling) */
  number: number;
  /** Output buffer instance for this session */
  outputBuffer: OutputBuffer;
  /** Cached scrollback chunks for view restore */
  scrollbackCache: string[];
  /** Total character count across all scrollback chunks */
  scrollbackSize: number;
  /** Timestamp of session creation */
  createdAt: number;
  /** Current terminal columns */
  cols: number;
  /** Current terminal rows */
  rows: number;
  /** Per-session event subscriptions for cleanup */
  disposables: Array<{ dispose(): void }>;
  /** Webview message sender for this session */
  webview: MessageSender;
  /** Whether this session is a split pane (not a root tab). Split pane sessions are excluded from getTabsForView(). */
  isSplitPane: boolean;
  /**
   * For split-pane children, the sessionId of the owning root tab (the
   * top-level entry in the webview's `tabLayouts`). For root tabs, this is
   * set to the session's own id so eviction can group reliably. See:
   * restore-terminal-sessions design.md D12 + round-1 B4.
   */
  rootTabId?: string;
  /** Stable linked-worktree owner. Absent means the main terminal bucket. */
  worktreeId?: string;
  /** Resolved cwd passed to the PTY at spawn time; used for resolving relative file paths in terminal links. */
  initialCwd?: string;
  /** Latest cwd observed from PTY OSC 7 / OSC 633 reports; undefined until the first parse. */
  currentCwd?: string;
  /** Resolved shell binary path (recorded on spawn so cross-restart restore can respawn the same shell). */
  shell?: string;
  /** Resolved shell args (recorded on spawn so cross-restart restore can respawn the same shell). */
  shellArgs?: string[];
  /**
   * True when this session's root process is an agent CLI launched from the vault
   * (claude/codex/opencode), not a shell. Persisted; drives the shell-fallback
   * behavior below. See SessionManager.respawnFallbackShell.
   */
  isAgentLaunch?: boolean;
  /**
   * The vault entry (`<agent>:<sessionId>`) this tab was launched to resume.
   * Persisted alongside `isAgentLaunch`, since a reload re-runs the same resume,
   * and cleared when the fallback shell takes the pane over. Read by the vault's
   * pinned-session mirror; a hook-reported identity outranks it.
   */
  vaultEntryId?: string;
  /**
   * The Claude session this pane is running by hand, while its tab is pinned —
   * kept current by the vault's pinned-session mirror from the process table.
   * Persisted so a restore can resume it; absent for an agent launch, whose
   * restore re-runs the launch itself.
   */
  resumeClaudeSessionId?: string;
  /**
   * Runtime one-shot: when the current PTY exits naturally, respawn the user's
   * default shell in this same tab instead of killing it. Set from `isAgentLaunch`
   * at each agent spawn (fresh launch + cross-restart restore) and cleared once
   * the fallback shell takes over, so the shell exiting behaves like a normal
   * terminal close. Not persisted — re-derived from `isAgentLaunch` on restore.
   */
  shellFallbackArmed?: boolean;
  /**
   * Runtime: true while this is a fresh shell tab nobody has typed into. An
   * agent launch from this view runs IN such a tab instead of opening a second
   * one beside it (see SessionManager.relaunchInPlace). Set only on a fresh,
   * non-agent root; cleared by the first input. Not persisted — a restored tab
   * carries history and is never untouched.
   */
  untouched?: boolean;
  /** For editor sessions, the panelId of the owning webview panel. Derived from viewId on session create. */
  panelId?: string;
  /**
   * Extension-host xterm-headless mirror used for cross-restart snapshots.
   * Lifecycle is owned by SnapshotPersistence; this field is set/cleared by
   * the collaborator (kept on the session so tests + legacy reads still work).
   */
  headless?: HeadlessTerminalLike;
  /** SerializeAddon instance loaded into the headless mirror. Owned by SnapshotPersistence. */
  serializeAddon?: SerializeAddonLike;
  /** True once the underlying shell has exited; the mirror is frozen and the session restores read-only. */
  shellExited?: boolean;
  /** Exit code recorded when the shell exits (or null when no code was reported). */
  exitCode?: number | null;
  /**
   * Per-session command tracker. Captures OSC 633 markers (A/B/C/D/E) and
   * builds the bounded `TrackedCommand[]` list consumed by the export
   * commands. Empty when shell integration is absent. Capped per design D5.
   * See: asimov/changes/export-terminal-session/design.md D1.
   */
  commandTracking: CommandTracker;
}

/** Aggregate memory usage snapshot across all sessions. */
export interface MemoryMetrics {
  /** Number of active sessions */
  sessionCount: number;
  /** Total characters in all output buffers (unflushed) */
  totalBufferSize: number;
  /** Total characters in all scrollback caches */
  totalScrollbackSize: number;
  /** Per-session breakdown */
  sessions: Array<{
    id: string;
    name: string;
    bufferSize: number;
    scrollbackSize: number;
    unackedCharCount: number;
  }>;
}
