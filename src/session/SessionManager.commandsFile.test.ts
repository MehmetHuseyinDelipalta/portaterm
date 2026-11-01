// Tracked commands persist in their own per-session file, written only when the
// list changes — never inline in the index that every flush rewrites (A2).

import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { headlessFactories, mockPtySessions, mockWebview, sessionStorageMock } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";
import type { SessionSnapshotMetadata } from "./SessionSnapshot";
import { SessionStorage } from "./SessionStorage";
import { SNAPSHOT_PERSIST_DEBOUNCE_MS } from "./SnapshotPersistence";
import type { TrackedCommand } from "./TrackedCommand";

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

function command(id: string): TrackedCommand {
  return {
    id,
    commandLine: `echo ${id}`,
    output: `${id}\r\n`,
    exitCode: 0,
    cwd: "/tmp",
    startedAt: 100,
    endedAt: 200,
    outputChars: id.length + 2,
    outputTruncated: false,
  };
}

function meta(sessionId: string, overrides: Partial<SessionSnapshotMetadata> = {}): SessionSnapshotMetadata {
  return {
    sessionId,
    viewLocation: "sidebar",
    terminalNumber: 1,
    customName: null,
    shell: "/bin/zsh",
    shellArgs: [],
    cwd: "/home/user",
    currentCwd: null,
    cols: 80,
    rows: 24,
    bufferFile: `snapshots/${sessionId}.snapshot.ans`,
    bufferBytes: 8,
    isSplitPane: false,
    rootTabId: sessionId,
    snapshotAt: Date.now(),
    shellExited: false,
    exitCode: null,
    ...overrides,
  };
}

function live(options: Parameters<typeof sessionStorageMock>[0] = {}) {
  const fx = headlessFactories({ serialize: (n) => `BUF#${n}` });
  const storage = sessionStorageMock(options);
  const sm = new SessionManager(undefined, {
    restoreEnabled: true,
    headlessFactory: fx.headless,
    serializeAddonFactory: fx.serialize,
    storage: storage as any,
  });
  return { sm, storage };
}

function runCommand(sm: SessionManager, sessionId: string, id: string): void {
  const tracker = sm.getSession(sessionId)!.commandTracking;
  tracker.open({ id, now: 100, cwd: "/tmp" });
  tracker.setCommandLine(`echo ${id}`);
  tracker.appendOutput(`${id}\r\n`);
  tracker.close({ exitCode: 0, now: 200 });
}

async function flush(pty = 0): Promise<void> {
  mockPtySessions[pty].onData?.("output");
  await vi.advanceTimersByTimeAsync(SNAPSHOT_PERSIST_DEBOUNCE_MS);
}

describe("tracked commands file (A2)", () => {
  it("writes the file on the flush after a command closes, and not again while only output flows", async () => {
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    runCommand(sm, id, "c1");
    await flush();

    expect(storage.commitCommandsAsync).toHaveBeenCalledTimes(1);
    expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["c1"]);

    await flush();
    await flush();
    expect(storage.commitBufferAsync).toHaveBeenCalledTimes(3);
    expect(storage.commitCommandsAsync).toHaveBeenCalledTimes(1);

    runCommand(sm, id, "c2");
    await flush();
    expect(storage.commitCommandsAsync).toHaveBeenCalledTimes(2);
    expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["c1", "c2"]);
    sm.dispose();
  });

  it("never creates a file for a session that has not completed a command", async () => {
    const { sm, storage } = live();
    sm.createSession("sidebar", mockWebview());
    await flush();
    await flush();

    expect(storage.commitBufferAsync).toHaveBeenCalledTimes(2);
    expect(storage.commitCommandsAsync).not.toHaveBeenCalled();
    expect(storage.commitCommandsSync).not.toHaveBeenCalled();
    sm.flushSnapshotsSync();
    expect(storage.commitCommandsSync).not.toHaveBeenCalled();
    sm.dispose();
  });

  it("keeps the debt when the write did not reach the file, and pays it on the next flush", async () => {
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    runCommand(sm, id, "c1");
    storage.commitCommandsAsync.mockResolvedValueOnce("stale-post-write");
    await flush();
    expect(storage._commands.has(id)).toBe(false);

    await flush();
    expect(storage.commitCommandsAsync).toHaveBeenCalledTimes(2);
    expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["c1"]);
    sm.dispose();
  });

  it("keeps the debt after a write that threw", async () => {
    const { sm, storage } = live();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = sm.createSession("sidebar", mockWebview());
    runCommand(sm, id, "c1");
    storage.commitCommandsAsync.mockRejectedValueOnce(new Error("disk full"));
    await flush();
    expect(error).toHaveBeenCalledWith("[Portaterm] commitLiveSnapshot commitCommandsAsync failed:", expect.any(Error));

    await flush();
    expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["c1"]);
    sm.dispose();
  });

  it("Cmd+K erases the file, and a later flush does not write the pre-clear list back", async () => {
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    runCommand(sm, id, "secret");
    await flush();
    expect(storage._commands.has(id)).toBe(true);

    sm.clearScrollback(id);
    expect(storage.dropCommands).toHaveBeenCalledWith(id);
    expect(storage._commands.has(id)).toBe(false);

    await flush();
    expect(storage._commands.has(id)).toBe(false);
    expect(storage.commitCommandsAsync).toHaveBeenCalledTimes(1);

    // Commands run after the clear are persisted as usual.
    runCommand(sm, id, "after");
    await flush();
    expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["after"]);
    sm.dispose();
  });

  it("a clear whose caller left the tracker populated still keeps those commands off disk", async () => {
    // Defense in depth (external-review B2): the privacy boundary must not
    // depend on every caller wiping the tracker first.
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    runCommand(sm, id, "secret");
    (sm as unknown as { snapshots: { commitClearSnapshot(id: string): void } }).snapshots.commitClearSnapshot(id);

    await flush();
    sm.flushSnapshotsSync();
    expect(storage._commands.has(id)).toBe(false);
    expect(storage.commitCommandsAsync).not.toHaveBeenCalled();
    expect(storage.commitCommandsSync).not.toHaveBeenCalled();
    sm.dispose();
  });

  it("an async write of the pre-clear list still in flight cannot recreate the file", async () => {
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    runCommand(sm, id, "secret");
    let land: () => void = () => {};
    storage.commitCommandsAsync.mockImplementationOnce(
      async (sid: string, _list: readonly TrackedCommand[], gen: number) => {
        await new Promise<void>((resolve) => {
          land = resolve;
        });
        // The double's own gen check, run AFTER the clear.
        return storage.currentCommandsGen(sid) === gen ? "renamed" : "stale-post-write";
      },
    );
    mockPtySessions[0].onData?.("output");
    await vi.advanceTimersByTimeAsync(SNAPSHOT_PERSIST_DEBOUNCE_MS);

    sm.clearScrollback(id);
    land();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(storage._commands.has(id)).toBe(false);
    sm.dispose();
  });

  it("destroying a session removes its file", async () => {
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    runCommand(sm, id, "c1");
    await flush();
    expect(storage._commands.has(id)).toBe(true);

    sm.destroySession(id);
    await vi.waitFor(() => expect(storage.dropBuffer).toHaveBeenCalledWith(id));
    expect(storage._commands.has(id)).toBe(false);
    sm.dispose();
  });

  it("deactivate's sync flush writes an owed list, and only an owed one", async () => {
    const { sm, storage } = live();
    const owed = sm.createSession("sidebar", mockWebview());
    const settled = sm.createSession("sidebar", mockWebview());
    runCommand(sm, settled, "s1");
    await flush(1);
    expect(storage._commands.has(settled)).toBe(true);
    mockPtySessions[0].onData?.("x"); // a mirror, so the session is flushed at all
    runCommand(sm, owed, "o1");

    sm.flushSnapshotsSync();

    expect(storage.commitCommandsSync).toHaveBeenCalledTimes(1);
    expect(storage.commitCommandsSync).toHaveBeenCalledWith(owed, [expect.objectContaining({ id: "o1" })]);
    sm.dispose();
  });

  it("the exit commit writes an owed list synchronously", () => {
    const { sm, storage } = live();
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    runCommand(sm, id, "last");

    mockPtySessions[0].onExit?.(0);

    expect(storage.commitCommandsSync).toHaveBeenCalledWith(id, [expect.objectContaining({ id: "last" })]);
    expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["last"]);
    sm.dispose();
  });

  describe("hydrate", () => {
    it("restores a session's commands from its file, and does not rewrite them", async () => {
      const { sm, storage } = live({ buffers: { S1: "BUF1" }, commands: { S1: [command("old")] } });
      sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1") } });
      const [snap] = sm.consumeSnapshotsForLocation("sidebar");
      expect(snap.metadata.trackedCommands?.map((c) => c.id)).toEqual(["old"]);

      const id = sm.createSession("sidebar", mockWebview(), { restoreFrom: snap });
      expect(sm.getSession(id)!.commandTracking.commands.map((c) => c.id)).toEqual(["old"]);
      await flush();
      expect(storage.commitCommandsAsync).not.toHaveBeenCalled();

      runCommand(sm, id, "new");
      await flush();
      expect(storage._commands.get(id)?.map((c) => c.id)).toEqual(["old", "new"]);
      sm.dispose();
    });

    it("moves commands an older build wrote inline into the session's file", () => {
      const { sm, storage } = live({ buffers: { S1: "BUF1" } });
      sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1", { trackedCommands: [command("legacy")] }) } });

      expect(storage.commitCommandsSync).toHaveBeenCalledWith("S1", [command("legacy")]);
      expect(storage._commands.get("S1")?.map((c) => c.id)).toEqual(["legacy"]);
      const [snap] = sm.consumeSnapshotsForLocation("sidebar");
      expect(snap.metadata.trackedCommands?.map((c) => c.id)).toEqual(["legacy"]);
      sm.dispose();
    });

    it("a move that failed leaves the restored session owing its first write", async () => {
      const { sm, storage } = live({ buffers: { S1: "BUF1" } });
      vi.spyOn(console, "error").mockImplementation(() => {});
      storage.commitCommandsSync.mockImplementationOnce(() => {
        throw new Error("EACCES");
      });
      sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1", { trackedCommands: [command("legacy")] }) } });
      const [snap] = sm.consumeSnapshotsForLocation("sidebar");
      sm.createSession("sidebar", mockWebview(), { restoreFrom: snap });

      await flush();
      expect(storage._commands.get("S1")?.map((c) => c.id)).toEqual(["legacy"]);
      sm.dispose();
    });

    it("attaches a file's commands to an entry rebuilt from an orphaned buffer", () => {
      const { sm } = live({ buffers: { ORPHAN: "BUF" }, commands: { ORPHAN: [command("kept")] } });
      sm.hydrateFromSnapshots({ version: 1, entries: {} });
      const [snap] = sm.consumeSnapshotsForLocation("sidebar");
      expect(snap.metadata.sessionId).toBe("ORPHAN");
      expect(snap.metadata.trackedCommands?.map((c) => c.id)).toEqual(["kept"]);
      sm.dispose();
    });

    it("removes a commands file whose session did not survive", () => {
      const { sm, storage } = live({ buffers: { S1: "BUF1" }, commands: { S1: [command("a")], GONE: [command("b")] } });
      sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1") } });

      expect(storage.dropCommands).toHaveBeenCalledWith("GONE");
      expect(storage.dropCommands).not.toHaveBeenCalledWith("S1");
      expect([...storage._commands.keys()]).toEqual(["S1"]);
      sm.dispose();
    });
  });

  describe("on a real disk, across a restart", () => {
    let dir: string;
    beforeEach(() => {
      dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "portaterm-commands-"));
    });
    afterEach(() => {
      nodeFs.rmSync(dir, { recursive: true, force: true });
    });

    function realStorage(): SessionStorage {
      const memento = { get: () => undefined, update: async () => {} } as unknown as vscode.Memento;
      return new SessionStorage(memento, { fsPath: dir } as vscode.Uri, nodeFs);
    }

    it("keeps the index free of command output, and restores the commands from their own file", async () => {
      const fx = headlessFactories({ serialize: () => "SCREEN" });
      const options = { restoreEnabled: true, headlessFactory: fx.headless, serializeAddonFactory: fx.serialize };
      const first = new SessionManager(undefined, { ...options, storage: realStorage() });
      const id = first.createSession("sidebar", mockWebview());
      runCommand(first, id, "c1");
      vi.useRealTimers();
      mockPtySessions[0].onData?.("output");
      await vi.waitFor(() => expect(nodeFs.existsSync(path.join(dir, "snapshots", `${id}.commands.json`))).toBe(true), {
        timeout: 5000,
      });
      await vi.waitFor(() => expect(nodeFs.existsSync(path.join(dir, "snapshots", "index.json"))).toBe(true));

      const index = JSON.parse(nodeFs.readFileSync(path.join(dir, "snapshots", "index.json"), "utf8"));
      expect(index.entries[id]).toBeDefined();
      expect(index.entries[id]).not.toHaveProperty("trackedCommands");
      expect(nodeFs.statSync(path.join(dir, "snapshots", `${id}.commands.json`)).mode & 0o777).toBe(0o600);
      first.flushSnapshotsSync();
      first.dispose();

      const second = new SessionManager(undefined, { ...options, storage: realStorage() });
      second.hydrateFromSnapshots();
      const [snap] = second.consumeSnapshotsForLocation("sidebar");
      const restored = second.createSession("sidebar", mockWebview(), { restoreFrom: snap });
      expect(second.getSession(restored)!.commandTracking.commands.map((c) => c.commandLine)).toEqual(["echo c1"]);
      second.dispose();
    });
  });
});
