// src/session/SessionManager.mirrorWrites.test.ts — a snapshot is taken only once
// the headless mirror has parsed what was written before it (perf A4 kept that
// promise with counters). The mirror here parses only when a test says so, as
// xterm's does asynchronously, and serializes only what it has parsed — so a
// flush that did not wait would store too little.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions, mockWebview, sessionStorageMock } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import type { HeadlessTerminalLike, SerializeAddonLike } from "./SessionManager";
import { SessionManager } from "./SessionManager";
import type { PendingSnapshot } from "./SessionSnapshot";

interface SlowMirror extends HeadlessTerminalLike {
  parsed: string;
  queue: Array<{ data: string; callback?: () => void }>;
  parseAll(): void;
}

function slowMirrors() {
  const built: SlowMirror[] = [];
  const headless = (cols: number, rows: number): SlowMirror => {
    const mirror: SlowMirror = {
      cols,
      rows,
      parsed: "",
      queue: [],
      write(data, callback) {
        this.queue.push({ data, callback });
      },
      parseAll() {
        while (this.queue.length > 0) {
          const { data, callback } = this.queue.shift()!;
          this.parsed = data === "\x1bc" ? "" : this.parsed + data;
          callback?.();
        }
      },
      resize() {},
      dispose() {},
      loadAddon(addon: unknown) {
        (addon as { mirror?: SlowMirror }).mirror = this;
      },
    };
    built.push(mirror);
    return mirror;
  };
  const serialize = (): SerializeAddonLike & { mirror?: SlowMirror } => ({
    serialize() {
      return this.mirror?.parsed ?? "";
    },
    dispose() {},
  });
  return { headless, serialize, built };
}

/** Whether `p` settles within a few turns of the event loop. */
async function settlesSoon(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => {
    done = true;
  });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  return done;
}

function setup() {
  const mirrors = slowMirrors();
  const storage = sessionStorageMock();
  const sm = new SessionManager(undefined, {
    restoreEnabled: true,
    headlessFactory: mirrors.headless,
    serializeAddonFactory: mirrors.serialize,
    storage: storage as never,
  });
  const id = sm.createSession("sidebar", mockWebview());
  const pty = mockPtySessions[mockPtySessions.length - 1];
  const committed = () => storage.commitBufferAsync.mock.calls.map(([, buffer]) => buffer as string);
  return { sm, id, pty, storage, mirrors, committed };
}

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
  mockPtySessions.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a snapshot waits for the mirror to parse", () => {
  it("serializes only after every chunk written before the flush is parsed", async () => {
    const { sm, id, pty, mirrors, committed } = setup();
    pty.onData?.("hello ");
    pty.onData?.("world");
    const flush = sm.flushSessionImmediate(id);
    expect(await settlesSoon(flush)).toBe(false);
    expect(committed()).toEqual([]);
    mirrors.built[0].parseAll();
    await flush;
    expect(committed()).toEqual(["hello world"]);
    sm.dispose();
  });

  it("waits for a clear's reset before serializing, so cleared output is not stored", async () => {
    const { sm, id, pty, mirrors, committed } = setup();
    pty.onData?.("secret");
    mirrors.built[0].parseAll();
    sm.clearScrollback(id);
    const flush = sm.flushSessionImmediate(id);
    expect(await settlesSoon(flush)).toBe(false);
    mirrors.built[0].parseAll();
    await flush;
    expect(committed()).toEqual([""]);
    sm.dispose();
  });

  it("waits for the restore seed of a new mirror, not for writes to the one it replaced", async () => {
    const { sm, id, pty, mirrors, committed } = setup();
    pty.onData?.("never parsed"); // the first mirror never gets to this
    const snapshots = (sm as unknown as { snapshots: { attachSession(s: unknown, r: PendingSnapshot): void } })
      .snapshots;
    snapshots.attachSession(sm.getSession(id), {
      metadata: { shellExited: false } as PendingSnapshot["metadata"],
      buffer: "restored",
    });
    const seeded = mirrors.built[1];
    const flush = sm.flushSessionImmediate(id);
    expect(await settlesSoon(flush)).toBe(false);
    seeded.parseAll();
    expect(await settlesSoon(flush)).toBe(true);
    expect(committed()).toEqual(["restored\r\x1b[2K"]);
    sm.dispose();
  });

  it("lets a flush waiting on a mirror go when restore is switched off", async () => {
    const { sm, id, pty } = setup();
    pty.onData?.("never parsed");
    const flush = sm.flushSessionImmediate(id);
    expect(await settlesSoon(flush)).toBe(false);
    sm.setRestoreEnabled(false);
    expect(await settlesSoon(flush)).toBe(true);
    sm.dispose();
  });

  it("starts counting afresh when restore is switched back on", async () => {
    const { sm, id, pty, mirrors, committed } = setup();
    pty.onData?.("never parsed");
    sm.setRestoreEnabled(false);
    sm.setRestoreEnabled(true);
    pty.onData?.("fresh");
    const fresh = mirrors.built[mirrors.built.length - 1];
    const flush = sm.flushSessionImmediate(id);
    fresh.parseAll();
    expect(await settlesSoon(flush)).toBe(true);
    expect(committed()).toEqual(["fresh"]);
    sm.dispose();
  });

  it("lets a flush waiting on a destroyed pane's mirror go", async () => {
    const { sm, id, pty } = setup();
    pty.onData?.("never parsed");
    const snapshots = (sm as unknown as { snapshots: { commitLiveSnapshot(id: string): Promise<void> } }).snapshots;
    const commit = snapshots.commitLiveSnapshot(id);
    expect(await settlesSoon(commit)).toBe(false);
    sm.destroySession(id);
    expect(await settlesSoon(commit)).toBe(true);
    sm.dispose();
  });

  it("counts a destroyed pane's writes no longer", async () => {
    const { sm, id, pty, storage } = setup();
    pty.onData?.("never parsed");
    const snapshots = (
      sm as unknown as {
        snapshots: { dropSession(id: string): void; commitLiveSnapshot(id: string): Promise<void> };
      }
    ).snapshots;
    snapshots.dropSession(id); // the pane itself lives on, its mirror is gone
    pty.onData?.("after");
    const session = sm.getSession(id) as unknown as { headless: SlowMirror };
    session.headless.parseAll();
    const commit = snapshots.commitLiveSnapshot(id);
    expect(await settlesSoon(commit)).toBe(true);
    expect(storage.commitBufferAsync.mock.calls.map(([, b]) => b)).toEqual(["after"]);
    sm.dispose();
  });
});
