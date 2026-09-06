// Live editor-panel registry tests.
// See: asimov/changes/restore-terminal-sessions/design.md D10.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { sessionStorageMock } from "../test/sessionMocks";
import { SessionManager } from "./SessionManager";

const makeStorageMock = () => sessionStorageMock();

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionManager live editor-panels registry", () => {
  it("register / attach / unregister update the in-memory map and schedule writes", () => {
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.registerEditorPanel("P1");
    sm.attachSessionToPanel("P1", "S1");
    sm.attachSessionToPanel("P1", "S2");

    const record = sm.getLiveEditorPanelsRecord();
    expect(record.panels).toHaveLength(1);
    expect(record.panels[0].panelId).toBe("P1");
    expect(record.panels[0].sessionIds).toEqual(["S1", "S2"]);
    expect(storage.scheduleLivePanelsWrite).toHaveBeenCalled();

    sm.unregisterEditorPanel("P1");
    expect(sm.getLiveEditorPanelsRecord().panels).toEqual([]);
    sm.dispose();
  });

  it("register is idempotent", () => {
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.registerEditorPanel("P1");
    const first = sm.getLiveEditorPanelsRecord().panels[0];
    sm.registerEditorPanel("P1");
    const second = sm.getLiveEditorPanelsRecord().panels[0];
    expect(second.createdAt).toBe(first.createdAt);
    sm.dispose();
  });

  it("attach is idempotent", () => {
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.registerEditorPanel("P1");
    sm.attachSessionToPanel("P1", "S1");
    sm.attachSessionToPanel("P1", "S1");
    expect(sm.getLiveEditorPanelsRecord().panels[0].sessionIds).toEqual(["S1"]);
    sm.dispose();
  });

  it("attach to unknown panelId is a silent no-op", () => {
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    expect(() => sm.attachSessionToPanel("never", "x")).not.toThrow();
    expect(sm.getLiveEditorPanelsRecord().panels).toEqual([]);
    sm.dispose();
  });

  it("does not call storage.scheduleLivePanelsWrite when restoreEnabled === false", () => {
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: false,
      storage: storage as any,
    });
    sm.registerEditorPanel("P1");
    sm.attachSessionToPanel("P1", "S1");
    expect(storage.scheduleLivePanelsWrite).not.toHaveBeenCalled();
    sm.dispose();
  });
});
