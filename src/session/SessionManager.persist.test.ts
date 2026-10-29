// Debounced persistence tests.
// See: asimov/changes/restore-terminal-sessions/design.md D6.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { headlessFactories, mockPtySessions, mockWebview, sessionStorageMock } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";
import type { SessionSnapshotsIndex } from "./SessionSnapshot";

const makeStorageMock = () => sessionStorageMock();
// The addon index is fixed per addon, so `BUF#n` is captured per addon exactly
// as the local factory's `const out` was.
const makeFactories = () => headlessFactories({ serialize: (n) => `BUF#${n}` });

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockPtySessions.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SessionManager debounced persistence", () => {
  it("coalesces 50 pty.onData events into 1 buffer write + 1 scheduleIndexWrite", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());

    for (let i = 0; i < 50; i++) {
      mockPtySessions[0].onData?.(`chunk-${i}`);
    }
    expect(storage.commitBufferAsync).not.toHaveBeenCalled();
    expect(storage.commitIndexAsync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.commitBufferAsync).toHaveBeenCalledTimes(1);
    expect(storage.commitIndexAsync).toHaveBeenCalledTimes(1);
    sm.dispose();
  });

  it("a meta change (rename) also schedules a persist", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");
    await vi.advanceTimersByTimeAsync(1000);
    storage.commitBufferAsync.mockClear();
    storage.commitIndexAsync.mockClear();

    sm.renameSession(id, "build");
    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.commitBufferAsync).toHaveBeenCalledTimes(1);
    expect(storage.commitIndexAsync).toHaveBeenCalledTimes(1);
    sm.dispose();
  });

  it("a pin change schedules a persist, and the index carries the pin until it is removed", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");
    await vi.advanceTimersByTimeAsync(1000);
    storage.commitIndexAsync.mockClear();
    const lastEntry = () =>
      (storage.commitIndexAsync.mock.calls.at(-1)?.[0] as SessionSnapshotsIndex | undefined)?.entries[id];

    sm.setPinned(id, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.commitIndexAsync).toHaveBeenCalledTimes(1);
    expect(lastEntry()?.pinned).toBe(true);

    sm.setPinned(id, false);
    await vi.advanceTimersByTimeAsync(1000);
    // Written only while pinned, so an unpinned entry looks like an older one.
    expect(lastEntry()).toBeDefined();
    expect(lastEntry()?.pinned).toBeUndefined();
    sm.dispose();
  });

  it("a color or icon change schedules a persist, and the index carries each only while set", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");
    await vi.advanceTimersByTimeAsync(1000);
    storage.commitIndexAsync.mockClear();
    const lastEntry = () =>
      (storage.commitIndexAsync.mock.calls.at(-1)?.[0] as SessionSnapshotsIndex | undefined)?.entries[id];

    sm.setTabAppearance(id, { tabColor: "green", tabIcon: "rocket" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.commitIndexAsync).toHaveBeenCalledTimes(1);
    expect(lastEntry()).toMatchObject({ tabColor: "green", tabIcon: "rocket" });

    sm.setTabAppearance(id, { tabColor: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.commitIndexAsync).toHaveBeenCalledTimes(2);
    // Written only while set, so a cleared entry looks like an older one.
    expect(lastEntry()).toBeDefined();
    expect(lastEntry() && "tabColor" in lastEntry()!).toBe(false);
    expect(lastEntry()?.tabIcon).toBe("rocket");

    sm.setTabAppearance(id, { tabIcon: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastEntry() && "tabIcon" in lastEntry()!).toBe(false);
    sm.dispose();
  });

  it("a setCurrentCwd update schedules a persist", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");
    await vi.advanceTimersByTimeAsync(1000);
    storage.commitBufferAsync.mockClear();
    storage.commitIndexAsync.mockClear();

    sm.setCurrentCwd(id, "/home/user/proj");
    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.commitBufferAsync).toHaveBeenCalledTimes(1);
    expect(storage.commitIndexAsync).toHaveBeenCalledTimes(1);
    sm.dispose();
  });

  it("destroy mid-flush does NOT resurrect the snapshot index entry (round-2 [W3])", async () => {
    // Setup: a flush is mid-await on writeBufferFileAsync when destroySession
    // fires. The pre-W3 code path would then synchronously re-insert the index
    // entry after detachSession had just dropped it — resurrecting a ghost.
    const fx = makeFactories();
    let resolveWrite: (outcome: "renamed" | "stale-skipped") => void = () => {};
    const writePromise = new Promise<"renamed" | "stale-skipped">((resolve) => {
      resolveWrite = resolve;
    });
    const storage = makeStorageMock();
    // Slow commitBufferAsync — held until we explicitly resolve it. Resolve
    // with "stale-skipped" since dropSession bumps the buffer gen during the
    // await; the real storage would return stale-skipped post-write check.
    storage.commitBufferAsync.mockImplementation(() => writePromise);

    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("hello");
    // Kick the debounce so flushPending starts.
    vi.advanceTimersByTime(1000);
    // Hand control back so flushPending awaits writeBufferFileAsync.
    await Promise.resolve();
    await Promise.resolve();

    // Destroy the session WHILE the async write is still in flight.
    // detachSession will unlink the file and drop the index entry.
    sm.destroySession(id);

    // Now release the write. Pre-W3: line 466 (`_snapshotIndex[id] = result.metadata`)
    // would resurrect the entry. Post-W3: the per-session liveness re-check
    // (`if (!this.getSession(id)) { unlinkBufferFile(id); continue; }`) skips
    // the assignment AND unlinks the just-written ghost file.
    resolveWrite("stale-skipped");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);

    // The async index commit at end-of-flush should NOT contain the
    // destroyed session (in-mem index dropped + on-disk dropped via
    // dropSession before the async commit lands).
    const idxCalls = storage.commitIndexAsync.mock.calls;
    const syncCalls = storage.commitIndexSync.mock.calls;
    const lastAsync = idxCalls[idxCalls.length - 1]?.[0] as { entries: Record<string, unknown> } | undefined;
    const lastSync = syncCalls[syncCalls.length - 1]?.[0] as { entries: Record<string, unknown> } | undefined;
    if (lastAsync) {
      expect(lastAsync.entries[id]).toBeUndefined();
    }
    if (lastSync) {
      expect(lastSync.entries[id]).toBeUndefined();
    }
    // dropSession (from cleanupSession with state="destroying") calls
    // storage.dropBuffer — the in-flight async commit returns stale-skipped
    // and never touches the canonical path.
    expect(storage.dropBuffer).toHaveBeenCalledWith(id);
    sm.dispose();
  });

  it("clearScrollback purges the persisted snapshot for a no-mirror restored-exited session (round-2 [B1])", async () => {
    // Setup: createSession with restoreFrom.metadata.shellExited === true.
    // attachSession skips headless-mirror seeding for exited sessions, so the
    // resulting TerminalSession has no `headless` field. resetMirror's
    // early-return on no-mirror previously left the persisted buffer + index
    // entry intact — Cmd+K on a restored-exited tab then resurrected the
    // cleared content on next restart. Post-B1: resetMirror routes through
    // purgePersistedSnapshot, which unlinks the buffer + drops the index entry.
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });

    const sessionId = "exited-session";
    const id = sm.createSession("sidebar", mockWebview(), {
      restoreFrom: {
        metadata: {
          sessionId,
          viewLocation: "sidebar",
          terminalNumber: 1,
          customName: null,
          shell: "/bin/zsh",
          shellArgs: [],
          cwd: "/tmp",
          currentCwd: null,
          cols: 80,
          rows: 24,
          bufferFile: `snapshots/${sessionId}.snapshot.ans`,
          bufferBytes: 100,
          isSplitPane: false,
          rootTabId: sessionId,
          snapshotAt: Date.now() - 1000,
          shellExited: true,
          exitCode: 0,
        },
        buffer: "stale content",
      },
    });

    // Confirm the precondition: no headless mirror on the exited session.
    expect(sm.getSession(id)?.headless).toBeUndefined();

    storage.dropBuffer.mockClear();
    storage.commitIndexAsync.mockClear();
    storage.commitIndexSync.mockClear();

    sm.clearScrollback(id);

    // No-mirror branch of commitClearSnapshot: drop the buffer + sync sidecar
    // commit. See design.md D15 (commitClearSnapshot replaces resetMirror
    // + purgePersistedSnapshot).
    expect(storage.dropBuffer).toHaveBeenCalledWith(id);
    expect(storage.commitIndexSync).toHaveBeenCalled();
    const lastIndexCall = storage.commitIndexSync.mock.calls.at(-1)?.[0] as
      | { entries: Record<string, unknown> }
      | undefined;
    expect(lastIndexCall?.entries[id]).toBeUndefined();
    sm.dispose();
  });

  it("[B2] clearScrollback writes a snapshot index entry with NO trackedCommands (privacy boundary survives restart)", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    // Drive at least one onData so the headless mirror is constructed —
    // commitClearSnapshot has separate code paths for no-mirror (restored-
    // exited, drops entry entirely) vs with-mirror (RIS + write empty buffer).
    // This test targets the with-mirror path because that's the live-shell
    // privacy boundary that B2 is about.
    mockPtySessions[0].onData?.("x");

    // Populate tracked commands so a clear would have something to wipe.
    const session = sm.getSession(id)!;
    session.commandTracking.open({ id: "c1", now: 100, cwd: "/tmp" });
    session.commandTracking.setCommandLine("secret command");
    session.commandTracking.appendOutput("sensitive output");
    session.commandTracking.close({ exitCode: 0, now: 200 });

    storage.commitIndexSync.mockClear();

    sm.clearScrollback(id);

    // The clear-path index entry must NOT carry trackedCommands forward.
    const lastIndexCall = storage.commitIndexSync.mock.calls.at(-1)?.[0] as
      | { entries: Record<string, { trackedCommands?: unknown }> }
      | undefined;
    const entry = lastIndexCall?.entries[id];
    expect(entry).toBeDefined();
    expect(entry?.trackedCommands).toBeUndefined();
    sm.dispose();
  });

  it("the setting kill-switch suppresses persistence", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: false,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());
    for (let i = 0; i < 10; i++) {
      mockPtySessions[0].onData?.("x");
    }
    await vi.advanceTimersByTimeAsync(2000);

    expect(storage.commitBufferAsync).not.toHaveBeenCalled();
    expect(storage.commitIndexAsync).not.toHaveBeenCalled();
    sm.dispose();
  });
});
