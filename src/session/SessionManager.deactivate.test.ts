// Two-step deactivate flush + idempotent dispose tests.
// See: asimov/changes/restore-terminal-sessions/design.md D6.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { headlessFactories, mockPtySessions, mockWebview, sessionStorageMock } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

const makeStorageMock = () => sessionStorageMock();
const makeFactories = () => headlessFactories({ serialize: () => "BUFFER" });

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

describe("SessionManager flushSnapshotsSync + flushIndexAwaited", () => {
  it("flushSnapshotsSync writes each active session's buffer synchronously", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const a = sm.createSession("sidebar", mockWebview());
    const b = sm.createSession("portaterm.panel", mockWebview());
    mockPtySessions[0].onData?.("aa");
    mockPtySessions[1].onData?.("bb");
    sm.flushSnapshotsSync();
    expect(storage.commitBufferSync).toHaveBeenCalledTimes(2);
    expect(storage.commitBufferSync).toHaveBeenCalledWith(a, "BUFFER");
    expect(storage.commitBufferSync).toHaveBeenCalledWith(b, "BUFFER");
    sm.dispose();
  });

  it("flushIndexAwaited writes live-panels (Memento) + syncs sidecar (D17)", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    sm.flushSnapshotsSync();
    await sm.flushIndexAwaited();
    // Live-panels still go to Memento (small + churnier — no dual-source bug
    // class). Snapshot index goes to the sidecar via commitIndexSync.
    expect(storage.writeLivePanelsAwaited).toHaveBeenCalledTimes(1);
    expect(storage.commitIndexSync).toHaveBeenCalled();
    sm.dispose();
  });

  it("flushSnapshotsSync is a no-op after dispose (idempotency)", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.dispose();
    sm.flushSnapshotsSync();
    expect(storage.commitBufferSync).not.toHaveBeenCalled();
  });

  it("dispose is idempotent — second call is a no-op", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
    });
    sm.createSession("sidebar", mockWebview());
    sm.dispose();
    expect(() => sm.dispose()).not.toThrow();
  });

  it("dispose does NOT itself flush — flush is owned by the caller", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    sm.dispose();
    expect(storage.commitBufferSync).not.toHaveBeenCalled();
    expect(storage.commitIndexSync).not.toHaveBeenCalled();
    expect(storage.writeLivePanelsAwaited).not.toHaveBeenCalled();
  });
});
