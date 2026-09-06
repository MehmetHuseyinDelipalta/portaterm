// Shared module mocks for SessionManager / provider tests.
//
// Each factory is the superset of what the per-file copies had drifted into, so
// a caller that does not use a member simply ignores it. Call them from inside
// a `vi.mock` factory, which runs lazily and so may await this import:
//
//   vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());

import { vi } from "vitest";
import type { MessageSender } from "../session/OutputBuffer";
import type {
  HeadlessFactory,
  HeadlessTerminalLike,
  SerializeAddonFactory,
  SerializeAddonLike,
} from "../session/TerminalSession";

/** Registered by every mocked PtySession so a test can drive its callbacks. */
interface MockPtyHandle {
  id: string;
  onData: ((data: string) => void) | undefined;
  onExit: ((code: number) => void) | undefined;
}

export const mockPtySessions: MockPtyHandle[] = [];

export function processCwdMock() {
  return { queryProcessCwd: vi.fn(async () => undefined) };
}

export function ptyManagerMock() {
  return {
    loadNodePty: vi.fn(() => ({ spawn: vi.fn() })),
    detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: ["--login"] })),
    buildEnvironment: vi.fn(() => ({ PATH: "/usr/bin" })),
    resolveWorkingDirectory: vi.fn(() => "/tmp"),
  };
}

export function ptySessionMock() {
  class MockPtySession {
    id: string;
    pid = 99000;
    spawn = vi.fn();
    write = vi.fn();
    resize = vi.fn();
    kill = vi.fn();
    dispose = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    setShellIntegrationSink = vi.fn();
    setShellIntegrationNonce = vi.fn();
    private _od: ((d: string) => void) | undefined;
    private _oe: ((c: number) => void) | undefined;
    get onData() {
      return this._od;
    }
    set onData(cb: ((d: string) => void) | undefined) {
      this._od = cb;
      const t = mockPtySessions.find((p) => p.id === this.id);
      if (t) {
        t.onData = cb;
      }
    }
    get onExit() {
      return this._oe;
    }
    set onExit(cb: ((c: number) => void) | undefined) {
      this._oe = cb;
      const t = mockPtySessions.find((p) => p.id === this.id);
      if (t) {
        t.onExit = cb;
      }
    }
    constructor(id: string) {
      this.id = id;
      mockPtySessions.push({ id, onData: undefined, onExit: undefined });
    }
  }
  return { PtySession: MockPtySession };
}

export function outputBufferMock() {
  class MockOutputBuffer {
    append = vi.fn();
    dispose = vi.fn();
    updateWebview = vi.fn();
    pauseOutput = vi.fn();
    resumeOutput = vi.fn();
    handleAck = vi.fn();
    flush = vi.fn();
    isOutputPaused = false;
    bufferSize = 0;
    unackedCharCount = 0;
    constructor(
      public _i: string,
      public _w: unknown,
      public _p: unknown,
    ) {}
  }
  return { OutputBuffer: MockOutputBuffer };
}

export function mockWebview(): MessageSender {
  return { postMessage: vi.fn(() => Promise.resolve(true)) };
}

export interface SessionStorageMockOptions {
  /**
   * Opt in to a backing buffer store. Absent (the default) means the reader
   * refuses: `readBufferFile` → null, `listBufferFiles` → []. Present means
   * commits are stored and read back, seeded from the given map.
   */
  buffers?: Record<string, string>;
}

/**
 * SessionStorage double for the SessionManager suites.
 *
 * Generation bookkeeping mirrors the real transactional storage: sync writers
 * and `dropBuffer` bump the artifact's generation, async writers report
 * `stale-skipped` when the generation they captured has since moved.
 *
 * `bufferFilePath` is a fixed stub with no override, because the injected
 * double is never asked for it — `SessionStorage` calls its own
 * (`SessionStorage.ts:245,312,336,379`), and the only path member the system
 * under test reads off the injected object is `bufferFileRelativePath`
 * (`SnapshotPersistence.ts:901`).
 */
export function sessionStorageMock(options: SessionStorageMockOptions = {}) {
  const backed = options.buffers !== undefined;
  const buffers = new Map<string, string>(Object.entries(options.buffers ?? {}));
  const bufferGens = new Map<string, number>();
  let sidecarGen = 0;

  const bumpBuffer = (id: string) => {
    bufferGens.set(id, (bufferGens.get(id) ?? 0) + 1);
  };

  return {
    commitBufferSync: vi.fn((id: string, data: string) => {
      if (backed) {
        buffers.set(id, data);
      }
      bumpBuffer(id);
    }),
    commitBufferAsync: vi.fn(async (id: string, data: string, capturedGen: number) => {
      if ((bufferGens.get(id) ?? 0) !== capturedGen) {
        return "stale-skipped" as const;
      }
      if (backed) {
        buffers.set(id, data);
      }
      return "renamed" as const;
    }),
    commitIndexSync: vi.fn((_idx?: unknown) => {
      sidecarGen += 1;
    }),
    commitIndexAsync: vi.fn(async (_idx: unknown, capturedGen: number) => {
      if (sidecarGen !== capturedGen) {
        return "stale-skipped" as const;
      }
      return "renamed" as const;
    }),
    dropBuffer: vi.fn((id: string) => {
      buffers.delete(id);
      bumpBuffer(id);
    }),
    currentBufferGen: vi.fn((id: string) => bufferGens.get(id) ?? 0),
    currentSidecarGen: vi.fn(() => sidecarGen),
    cleanupOrphanTemps: vi.fn(),
    scheduleLivePanelsWrite: vi.fn(),
    writeIndexAwaited: vi.fn(async () => {}),
    writeLivePanelsAwaited: vi.fn(async () => {}),
    readBufferFile: vi.fn((id: string) => (backed ? (buffers.get(id) ?? null) : null)),
    listBufferFiles: vi.fn(() => (backed ? Array.from(buffers.keys()) : [])),
    loadIndex: () => undefined,
    loadLivePanels: () => undefined,
    bufferFilePath: (id: string) => `/tmp/${id}`,
    bufferFileRelativePath: (id: string) => `snapshots/${id}.snapshot.ans`,
    cancelPendingIndex: vi.fn(),
    purge: vi.fn(async () => {}),
    /** Backing store, present whether or not `buffers` was passed; empty when not. */
    _buffers: buffers,
  };
}

export interface HeadlessFactoriesOptions {
  /**
   * Decides the serialized payload. Called on every `serialize()` invocation
   * with the addon's own 1-based construction index, so a suite can return a
   * value captured per addon or advance a counter per call.
   */
  serialize?: (addonIndex: number) => string;
  /** Receives every `write` payload, in order. The write callback still fires. */
  onWrite?: (data: string) => void;
  /** Expose the constructed terminals and addons, each carrying a `disposed` flag. */
  track?: boolean;
}

/**
 * Headless-terminal + SerializeAddon factory pair for the SessionManager suites.
 *
 * The factory owns the shape; each suite owns its values through `serialize`.
 * `SessionManager.snapshot.test.ts` deliberately keeps its own pair: it records
 * addon call counts and options and omits the write callback, and that
 * instrumentation is what the suite exists to observe.
 */
export function headlessFactories(options: HeadlessFactoriesOptions = {}) {
  const builtHeadless: Array<HeadlessTerminalLike & { disposed: boolean }> = [];
  const builtAddons: Array<SerializeAddonLike & { disposed: boolean }> = [];
  let addonCount = 0;

  const headless: HeadlessFactory = (cols, rows) => {
    const inst = {
      cols,
      rows,
      write(data: string, cb?: () => void) {
        options.onWrite?.(data);
        cb?.();
      },
      resize() {},
      disposed: false,
      dispose() {
        this.disposed = true;
      },
      loadAddon() {},
    };
    if (options.track) {
      builtHeadless.push(inst);
    }
    return inst;
  };

  const serialize: SerializeAddonFactory = () => {
    const index = ++addonCount;
    const inst = {
      disposed: false,
      serialize: () => options.serialize?.(index) ?? `BUF#${index}`,
      dispose() {
        this.disposed = true;
      },
    };
    if (options.track) {
      builtAddons.push(inst);
    }
    return inst;
  };

  return { headless, serialize, builtHeadless, builtAddons };
}
