// Mid-session toggle of `anywhereTerminal.sessionRestore.enabled`.
// See: asimov/changes/restore-terminal-sessions/design.md D11.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { headlessFactories, mockPtySessions, mockWebview, sessionStorageMock } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

const makeStorageMock = () => sessionStorageMock();
const makeFactories = () => headlessFactories({ serialize: () => "X", track: true });

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

describe("SessionManager.setRestoreEnabled", () => {
  it("true → false disposes every mirror + cached addon, cancels debounce, calls storage.purge", async () => {
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
    sm.generateSnapshotMetadata(id); // ensure addon was constructed
    expect(fx.builtHeadless).toHaveLength(1);
    expect(fx.builtAddons).toHaveLength(1);

    sm.setRestoreEnabled(false);

    expect((fx.builtHeadless[0] as any).disposed).toBe(true);
    expect((fx.builtAddons[0] as any).disposed).toBe(true);
    expect(storage.purge).toHaveBeenCalledTimes(1);
    expect(sm.isRestoreEnabled()).toBe(false);

    // Subsequent data is NOT mirrored or persisted.
    mockPtySessions[0].onData?.("after");
    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.builtHeadless).toHaveLength(1);
    expect(storage.commitBufferAsync).not.toHaveBeenCalled();
    sm.dispose();
  });

  it("does not resurrect snapshot files or index writes when disabled during an in-flight async flush", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    let resolveWrite: (() => void) | undefined;
    storage.commitBufferAsync.mockImplementation(
      () =>
        new Promise<"renamed" | "stale-skipped">((resolve) => {
          resolveWrite = () => resolve("renamed");
        }),
    );
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");

    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.commitBufferAsync).toHaveBeenCalledWith(id, "X", 0);

    sm.setRestoreEnabled(false);
    resolveWrite?.();
    await Promise.resolve();
    await Promise.resolve();

    // After setRestoreEnabled(false), storage.purge is called (which clears
    // the buffer + sidecar). Subsequent index writes don't fire because the
    // persist pipeline is disabled.
    expect(storage.purge).toHaveBeenCalled();
    expect(storage.commitIndexAsync).not.toHaveBeenCalled();
    sm.dispose();
  });

  it("false → true lazily reconstructs the mirror on next data", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: false,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("pre-toggle");
    expect(fx.builtHeadless).toHaveLength(0);

    sm.setRestoreEnabled(true);
    mockPtySessions[0].onData?.("post-toggle");
    expect(fx.builtHeadless).toHaveLength(1);
    sm.dispose();
  });

  it("setting to the same value is a no-op", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: false,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.setRestoreEnabled(false);
    expect(storage.purge).not.toHaveBeenCalled();
  });
});
