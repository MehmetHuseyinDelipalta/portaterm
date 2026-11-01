import type * as vscode from "vscode";
import type { VaultRefreshHint } from "../vault/cacheTypes";
import type { VaultSessionDetail } from "../vault/types";
import type { VaultService, VaultWatchTarget } from "../vault/VaultService";
import type { WatcherPool } from "./fsWatcherPool";

const STORE_REFRESH_DEBOUNCE_MS = 300;
const STORE_REFRESH_MAX_WAIT_MS = 1000;
/**
 * A file CREATED in an agent-routed store is a new session: nothing is gained by
 * waiting for a burst to settle, and the routed read it triggers is cheap. Short
 * rather than zero so the creates of one action (a transcript and its sidecar)
 * still land in one read.
 */
const STORE_CREATE_REFRESH_DEBOUNCE_MS = 40;
const FOLLOW_REFRESH_DEBOUNCE_MS = 400;
const MAX_TARGETED_REFRESH_PATHS = 128;

type VaultWatchService = Pick<VaultService, "getStoreWatchTargets" | "resolveSessionWatchTargets" | "getDetail">;
type PatternWatcherPool = Pick<WatcherPool, "subscribePattern">;
type Disposable = { dispose(): void };

export interface VaultWatchCallbacks {
  refreshList(hint?: VaultRefreshHint): void;
  postFollowDetail(entryId: string, detail: VaultSessionDetail): void;
}

export interface VaultWatchClient extends Disposable {
  watchSession(entryId: string | null): Promise<void>;
  /**
   * Whether the webview this client serves is on screen. Hidden, events are
   * still recorded but nothing is read: a `retainContextWhenHidden` view kept
   * re-reading stores and pushing lists and transcripts nobody could see. Shown
   * again, whatever was missed is read once.
   */
  setDisplayed(displayed: boolean): void;
}

export interface VaultWatchCoordinatorDeps {
  watcherPool: PatternWatcherPool;
  vaultService: VaultWatchService;
}

const NOOP_CLIENT: VaultWatchClient = {
  watchSession: async () => {},
  setDisplayed: () => {},
  dispose: () => {},
};

function subscribeTargets(
  watcherPool: PatternWatcherPool,
  targets: VaultWatchTarget[],
  onEvent: (target: VaultWatchTarget, uri: vscode.Uri, kind: "create" | "change" | "delete") => void,
  onError: (target: VaultWatchTarget, error: unknown) => void,
): Disposable[] {
  const watchers: Disposable[] = [];
  for (const target of targets) {
    try {
      const events = target.events ?? ["create", "change", "delete"];
      watchers.push(
        watcherPool.subscribePattern(target.baseDir, target.glob, {
          ...(events.includes("create") ? { create: (uri: vscode.Uri) => onEvent(target, uri, "create") } : {}),
          ...(events.includes("change") ? { change: (uri: vscode.Uri) => onEvent(target, uri, "change") } : {}),
          ...(events.includes("delete") ? { delete: (uri: vscode.Uri) => onEvent(target, uri, "delete") } : {}),
        }),
      );
    } catch (error) {
      onError(target, error);
    }
  }
  return watchers;
}

/** Routed reads for targets that declared `minIntervalMs`, one bucket per agent. */
interface ThrottledRefresh {
  paths: Set<string>;
  minIntervalMs: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** When this bucket last flushed (epoch ms); `undefined` before its first flush. */
  lastFlushAt: number | undefined;
}

class StoreWatchLifecycle implements Disposable {
  private watchers: Disposable[] = [];
  private readonly throttled = new Map<VaultRefreshHint["agent"], ThrottledRefresh>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingAgent: VaultRefreshHint["agent"] | undefined;
  private readonly pendingPaths = new Set<string>();
  private fullRefreshPending = false;
  /** A new-session flush is armed; later events join it rather than push it back. */
  private createFlushArmed = false;
  /** Off screen, events accumulate and no timer runs; see `setDisplayed`. */
  private displayed = true;
  private disposed = false;

  constructor(
    deps: VaultWatchCoordinatorDeps,
    private readonly refreshList: VaultWatchCallbacks["refreshList"],
  ) {
    this.watchers = subscribeTargets(
      deps.watcherPool,
      deps.vaultService.getStoreWatchTargets(),
      (target, uri, kind) => this.scheduleRefresh(target, uri, kind),
      (target, error) => {
        console.error("[Portaterm] Failed to watch vault store:", target.baseDir, error);
      },
    );
  }

  private scheduleRefresh(
    target: VaultWatchTarget,
    uri: vscode.Uri | undefined,
    kind: "create" | "change" | "delete" = "change",
  ): void {
    if (this.disposed) {
      return;
    }
    if (target.minIntervalMs !== undefined && target.agent && uri?.fsPath) {
      this.scheduleThrottled(target.agent, uri.fsPath, target.minIntervalMs);
      return;
    }
    if (!target.agent || !uri?.fsPath || (this.pendingAgent && this.pendingAgent !== target.agent)) {
      this.fullRefreshPending = true;
      this.pendingAgent = undefined;
      this.pendingPaths.clear();
    } else if (!this.fullRefreshPending) {
      this.pendingAgent = target.agent;
      this.pendingPaths.add(uri.fsPath);
      if (this.pendingPaths.size > MAX_TARGETED_REFRESH_PATHS) {
        this.fullRefreshPending = true;
        this.pendingAgent = undefined;
        this.pendingPaths.clear();
      }
    }
    if (this.createFlushArmed || !this.displayed) {
      return; // already flushing soon, or owed until shown; this event rides along
    }
    // Only a routed read is cheap enough to run at once: an unrouted create still
    // waits out the burst, since it re-reads every store.
    const fast = kind === "create" && target.agent !== undefined && !this.fullRefreshPending;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.createFlushArmed = fast;
    this.refreshTimer = setTimeout(
      () => this.flushRefresh(),
      fast ? STORE_CREATE_REFRESH_DEBOUNCE_MS : STORE_REFRESH_DEBOUNCE_MS,
    );
    this.maxWaitTimer ??= setTimeout(() => this.flushRefresh(), STORE_REFRESH_MAX_WAIT_MS);
  }

  /**
   * A throttled target's events gather in their own bucket rather than the shared
   * pending set: they arrive constantly, and folding them in would keep pushing
   * back — or widening into a full read — the cheap routed reads of every other
   * store. The bucket flushes once the burst settles, but never sooner than
   * `minIntervalMs` after its previous flush, and always after the last event.
   */
  private scheduleThrottled(agent: VaultRefreshHint["agent"], fsPath: string, minIntervalMs: number): void {
    let bucket = this.throttled.get(agent);
    if (!bucket) {
      bucket = { paths: new Set(), minIntervalMs, timer: undefined, lastFlushAt: undefined };
      this.throttled.set(agent, bucket);
    }
    bucket.minIntervalMs = minIntervalMs;
    if (bucket.paths.size < MAX_TARGETED_REFRESH_PATHS) {
      bucket.paths.add(fsPath);
    }
    if (bucket.timer || !this.displayed) {
      return; // already due, or owed until shown; this event rides along
    }
    this.armThrottled(agent, bucket, STORE_REFRESH_DEBOUNCE_MS);
  }

  /** Due after `floorMs`, and never sooner than the bucket's interval after its last flush. */
  private armThrottled(agent: VaultRefreshHint["agent"], bucket: ThrottledRefresh, floorMs: number): void {
    const earliest = bucket.lastFlushAt === undefined ? 0 : bucket.lastFlushAt + bucket.minIntervalMs - Date.now();
    bucket.timer = setTimeout(() => this.flushThrottled(agent), Math.max(floorMs, earliest));
  }

  /**
   * Hidden: stop every timer but keep what the events recorded. Shown: read what
   * was missed — the ordinary pending set at once, a throttled bucket as soon as
   * its interval allows. Nothing missed, nothing read.
   */
  setDisplayed(displayed: boolean): void {
    if (this.disposed || displayed === this.displayed) {
      return;
    }
    this.displayed = displayed;
    if (!displayed) {
      this.clearTimers();
      for (const bucket of this.throttled.values()) {
        if (bucket.timer) {
          clearTimeout(bucket.timer);
          bucket.timer = undefined;
        }
      }
      return;
    }
    if (this.fullRefreshPending || this.pendingAgent) {
      this.emitPending();
    }
    for (const [agent, bucket] of this.throttled) {
      if (bucket.paths.size > 0 && !bucket.timer) {
        this.armThrottled(agent, bucket, 0);
      }
    }
  }

  private flushThrottled(agent: VaultRefreshHint["agent"]): void {
    const bucket = this.throttled.get(agent);
    if (!bucket || this.disposed) {
      return;
    }
    bucket.timer = undefined;
    bucket.lastFlushAt = Date.now();
    const paths = [...bucket.paths];
    bucket.paths.clear();
    if (paths.length > 0) {
      this.refreshList({ agent, paths });
    }
  }

  private flushRefresh(): void {
    if (!this.refreshTimer && !this.maxWaitTimer) {
      this.createFlushArmed = false;
      return;
    }
    this.clearTimers();
    if (this.disposed) {
      return;
    }
    this.emitPending();
  }

  private clearTimers(): void {
    this.createFlushArmed = false;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }
  }

  private emitPending(): void {
    const hint =
      !this.fullRefreshPending && this.pendingAgent
        ? { agent: this.pendingAgent, paths: [...this.pendingPaths] }
        : undefined;
    this.pendingAgent = undefined;
    this.pendingPaths.clear();
    this.fullRefreshPending = false;
    this.refreshList(hint);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.flushRefresh();
    // A throttled read is dropped rather than flushed: a webview that asks for the
    // list again gets a complete read, which covers whatever this one was owed.
    for (const bucket of this.throttled.values()) {
      if (bucket.timer) {
        clearTimeout(bucket.timer);
      }
    }
    this.throttled.clear();
    this.pendingAgent = undefined;
    this.pendingPaths.clear();
    this.fullRefreshPending = false;
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}

class FollowWatchLifecycle implements Disposable {
  private watchers: Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  private refreshSeq = 0;
  private watchedEntryId: string | undefined;
  private readonly detailReads = new Map<string, { inFlight: boolean; dirtyRefreshSeq: number | undefined }>();
  /** The re-read a debounce timer is counting down to, so hiding can keep it owed. */
  private pendingRefresh: { entryId: string; seq: number } | undefined;
  /** A change seen while hidden, read once the view is shown again. */
  private owedRefresh: { entryId: string; seq: number } | undefined;
  private displayed = true;
  private disposed = false;

  constructor(
    private readonly deps: VaultWatchCoordinatorDeps,
    private readonly postDetail: VaultWatchCallbacks["postFollowDetail"],
  ) {}

  async watchSession(entryId: string | null): Promise<void> {
    if (this.disposed) {
      return;
    }
    const previousEntryId = this.watchedEntryId;
    this.disposeWatchers();
    const seq = ++this.seq;
    this.watchedEntryId = entryId ?? undefined;
    if (previousEntryId && previousEntryId !== entryId && !this.detailReads.get(previousEntryId)?.inFlight) {
      this.detailReads.delete(previousEntryId);
    }
    if (!entryId) {
      return;
    }
    const targets = await this.deps.vaultService.resolveSessionWatchTargets(entryId);
    if (this.disposed || seq !== this.seq) {
      return;
    }
    this.watchers = subscribeTargets(
      this.deps.watcherPool,
      targets,
      () => this.scheduleRefresh(entryId, seq),
      (_target, error) => {
        console.error("[Portaterm] Failed to watch vault session:", entryId, error);
      },
    );
  }

  private scheduleRefresh(entryId: string, seq: number): void {
    if (this.disposed || seq !== this.seq) {
      return;
    }
    if (!this.displayed) {
      this.owedRefresh = { entryId, seq };
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const refreshSeq = ++this.refreshSeq;
    this.pendingRefresh = { entryId, seq };
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.pendingRefresh = undefined;
      void this.pushDetail(entryId, seq, refreshSeq);
    }, FOLLOW_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Hidden: a re-read counting down becomes owed, and later changes only mark it
   * owed. Shown: an owed re-read of the session still being followed runs once,
   * after the usual debounce.
   */
  setDisplayed(displayed: boolean): void {
    if (this.disposed || displayed === this.displayed) {
      return;
    }
    this.displayed = displayed;
    if (!displayed) {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
        this.refreshSeq++;
        this.owedRefresh = this.pendingRefresh;
      }
      this.pendingRefresh = undefined;
      return;
    }
    const owed = this.owedRefresh;
    this.owedRefresh = undefined;
    if (owed && owed.seq === this.seq) {
      this.scheduleRefresh(owed.entryId, owed.seq);
    }
  }

  private async pushDetail(entryId: string, seq: number, refreshSeq: number): Promise<void> {
    if (this.disposed || seq !== this.seq || refreshSeq !== this.refreshSeq) {
      return;
    }
    const read = this.detailReads.get(entryId) ?? { inFlight: false, dirtyRefreshSeq: undefined };
    this.detailReads.set(entryId, read);
    if (read.inFlight) {
      read.dirtyRefreshSeq = refreshSeq;
      return;
    }
    read.inFlight = true;
    try {
      const detail = await this.deps.vaultService.getDetail(entryId);
      if (this.disposed || seq !== this.seq || refreshSeq !== this.refreshSeq) {
        return;
      }
      if (detail) {
        this.postDetail(entryId, detail);
      }
    } catch (err) {
      console.error("[Portaterm] Vault follow re-read failed:", entryId, err);
    } finally {
      read.inFlight = false;
      const dirtyRefreshSeq = read.dirtyRefreshSeq;
      read.dirtyRefreshSeq = undefined;
      if (dirtyRefreshSeq !== undefined && !this.disposed && seq === this.seq && dirtyRefreshSeq === this.refreshSeq) {
        void this.pushDetail(entryId, seq, dirtyRefreshSeq);
      } else if (entryId !== this.watchedEntryId) {
        this.detailReads.delete(entryId);
      }
    }
  }

  private disposeWatchers(): void {
    this.refreshSeq++;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.seq++;
    this.disposeWatchers();
    this.detailReads.clear();
  }
}

class AttachedVaultWatchClient implements VaultWatchClient {
  private readonly store: StoreWatchLifecycle;
  private readonly follow: FollowWatchLifecycle;
  private disposed = false;

  constructor(
    deps: VaultWatchCoordinatorDeps,
    callbacks: VaultWatchCallbacks,
    private readonly onDispose: () => void,
  ) {
    this.store = new StoreWatchLifecycle(deps, callbacks.refreshList);
    this.follow = new FollowWatchLifecycle(deps, callbacks.postFollowDetail);
  }

  watchSession(entryId: string | null): Promise<void> {
    return this.follow.watchSession(entryId);
  }

  /** Each lifecycle ignores this once disposed. */
  setDisplayed(displayed: boolean): void {
    this.store.setDisplayed(displayed);
    this.follow.setDisplayed(displayed);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.store.dispose();
    this.follow.dispose();
    this.onDispose();
  }
}

export class VaultWatchCoordinator implements Disposable {
  private readonly clients = new Set<AttachedVaultWatchClient>();
  private disposed = false;

  constructor(private readonly deps: VaultWatchCoordinatorDeps) {}

  attach(callbacks: VaultWatchCallbacks): VaultWatchClient {
    if (this.disposed) {
      return NOOP_CLIENT;
    }
    let client: AttachedVaultWatchClient;
    client = new AttachedVaultWatchClient(this.deps, callbacks, () => this.clients.delete(client));
    this.clients.add(client);
    return client;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const client of [...this.clients]) {
      client.dispose();
    }
    this.clients.clear();
  }
}
