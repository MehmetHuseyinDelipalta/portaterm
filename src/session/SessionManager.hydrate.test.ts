// Hydrate-on-activate tests.
// See: asimov/changes/restore-terminal-sessions/design.md D7.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockWebview, sessionStorageMock } from "../test/sessionMocks";
import type { LiveEditorPanelsRecord, SessionSnapshotMetadata, SessionSnapshotsIndex } from "./SessionSnapshot";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

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

const makeStorageMock = (initial: { buffers?: Record<string, string> } = {}) =>
  sessionStorageMock({ buffers: initial.buffers ?? {} });

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionManager.hydrateFromSnapshots", () => {
  it("happy path: stages every entry that has a readable buffer file", () => {
    const storage = makeStorageMock({ buffers: { S1: "BUF1", S2: "BUF2" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    const index: SessionSnapshotsIndex = {
      version: 1,
      entries: { S1: meta("S1"), S2: meta("S2", { viewLocation: "panel" }) },
    };
    sm.hydrateFromSnapshots(index);

    const sidebarSnaps = sm.consumeSnapshotsForLocation("sidebar");
    const panelSnaps = sm.consumeSnapshotsForLocation("panel");
    expect(sidebarSnaps.map((s) => s.metadata.sessionId)).toEqual(["S1"]);
    expect(sidebarSnaps[0].buffer).toBe("BUF1");
    expect(panelSnaps.map((s) => s.metadata.sessionId)).toEqual(["S2"]);
    expect(panelSnaps[0].buffer).toBe("BUF2");
    sm.dispose();
  });

  it("drops entries whose buffer file is missing", () => {
    const storage = makeStorageMock({ buffers: { S1: "BUF1" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1"), S2_missing: meta("S2_missing") } });

    expect(sm.hasSnapshotsForLocation("sidebar")).toBe(true);
    const all = sm.consumeSnapshotsForLocation("sidebar");
    expect(all.map((s) => s.metadata.sessionId)).toEqual(["S1"]);
    sm.dispose();
  });

  it("reconstructs orphan buffer files not referenced by a non-empty surviving index", () => {
    const storage = makeStorageMock({ buffers: { S1: "BUF1", orphan_X: "ORPHAN" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1") } });

    const all = sm.consumeSnapshotsForLocation("sidebar");
    expect(new Set(all.map((s) => s.metadata.sessionId))).toEqual(new Set(["S1", "orphan_X"]));
    expect(storage.dropBuffer).not.toHaveBeenCalledWith("orphan_X");
    sm.dispose();
  });

  it("reconstructs a minimal index from buffer files when the index is missing/empty", () => {
    const storage = makeStorageMock({ buffers: { S1: "BUF1", S2: "BUF2" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.hydrateFromSnapshots(undefined);

    const all = sm.consumeSnapshotsForLocation("sidebar");
    expect(new Set(all.map((s) => s.metadata.sessionId))).toEqual(new Set(["S1", "S2"]));
    // All reconstructed entries default to sidebar.
    expect(all.every((s) => s.metadata.viewLocation === "sidebar")).toBe(true);
    sm.dispose();
  });

  it("KEEPS exited entries (read-only restore — D13)", () => {
    const storage = makeStorageMock({ buffers: { S1: "BUF1" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.hydrateFromSnapshots({
      version: 1,
      entries: { S1: meta("S1", { shellExited: true, exitCode: 137 }) },
    });
    const all = sm.consumeSnapshotsForLocation("sidebar");
    expect(all).toHaveLength(1);
    expect(all[0].metadata.shellExited).toBe(true);
    expect(all[0].metadata.exitCode).toBe(137);
    sm.dispose();
  });

  it("consume* methods drain the pending map (idempotent on second call)", () => {
    const storage = makeStorageMock({ buffers: { S1: "BUF1" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.hydrateFromSnapshots({ version: 1, entries: { S1: meta("S1") } });
    expect(sm.consumeSnapshotsForLocation("sidebar")).toHaveLength(1);
    expect(sm.consumeSnapshotsForLocation("sidebar")).toHaveLength(0);
    sm.dispose();
  });

  it("consumeSnapshotsForPanel matches only by panelId", () => {
    const storage = makeStorageMock({ buffers: { E1: "BUF1", E2: "BUF2" } });
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      storage: storage as any,
    });
    sm.hydrateFromSnapshots({
      version: 1,
      entries: {
        E1: meta("E1", { viewLocation: "editor", panelId: "P1" }),
        E2: meta("E2", { viewLocation: "editor", panelId: "P2" }),
      },
    });
    expect(sm.consumeSnapshotsForPanel("P1").map((s) => s.metadata.sessionId)).toEqual(["E1"]);
    expect(sm.consumeSnapshotsForPanel("P2").map((s) => s.metadata.sessionId)).toEqual(["E2"]);
    sm.dispose();
  });
});

describe("SessionManager restore: pinned tabs", () => {
  it("restores a pinned tab as pinned, and an older entry without the field as unpinned", () => {
    const storage = makeStorageMock({ buffers: { PIN: "BUF", OLD: "BUF" } });
    const sm = new SessionManager(undefined, { restoreEnabled: true, storage: storage as any });
    sm.hydrateFromSnapshots({
      version: 1,
      entries: { PIN: meta("PIN", { pinned: true }), OLD: meta("OLD", { terminalNumber: 2 }) },
    });
    const ids = sm
      .consumeSnapshotsForLocation("sidebar")
      .map((restoreFrom) => sm.createSession("sidebar", mockWebview(), { restoreFrom }));

    expect(ids.map((id) => sm.isPinned(id))).toEqual([true, false]);
    sm.dispose();
  });
});

describe("SessionManager restore: tab color and icon", () => {
  it("restores a known color and icon, and reads an unknown id or an older entry as none", () => {
    const storage = makeStorageMock({ buffers: { SET: "BUF", ODD: "BUF", OLD: "BUF" } });
    const sm = new SessionManager(undefined, { restoreEnabled: true, storage: storage as any });
    sm.hydrateFromSnapshots({
      version: 1,
      entries: {
        SET: meta("SET", { tabColor: "magenta", tabIcon: "database" }),
        ODD: meta("ODD", { terminalNumber: 2, tabColor: "plaid", tabIcon: "unicorn" }),
        OLD: meta("OLD", { terminalNumber: 3 }),
      },
    });
    const ids = sm
      .consumeSnapshotsForLocation("sidebar")
      .map((restoreFrom) => sm.createSession("sidebar", mockWebview(), { restoreFrom }));

    expect(ids.map((id) => [sm.getSession(id)?.tabColor, sm.getSession(id)?.tabIcon])).toEqual([
      ["magenta", "database"],
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect(sm.getTabsForView("sidebar").map((t) => [t.tabColor, t.tabIcon])).toEqual([
      ["magenta", "database"],
      [undefined, undefined],
      [undefined, undefined],
    ]);
    sm.dispose();
  });

  it("never gives a restored split pane a color or icon of its own", () => {
    const storage = makeStorageMock({ buffers: { PANE: "BUF" } });
    const sm = new SessionManager(undefined, { restoreEnabled: true, storage: storage as any });
    sm.hydrateFromSnapshots({
      version: 1,
      entries: { PANE: meta("PANE", { isSplitPane: true, rootTabId: "ROOT", tabColor: "red", tabIcon: "bug" }) },
    });
    const [restoreFrom] = sm.consumeSnapshotsForLocation("sidebar");
    const id = sm.createSession("sidebar", mockWebview(), { restoreFrom });
    expect(sm.getSession(id)?.tabColor).toBeUndefined();
    expect(sm.getSession(id)?.tabIcon).toBeUndefined();
    sm.dispose();
  });
});

describe("SessionManager.hydrateLivePanels", () => {
  it("populates the live-panels map from a record", () => {
    const sm = new SessionManager(undefined, { restoreEnabled: true });
    const rec: LiveEditorPanelsRecord = {
      version: 1,
      panels: [
        { panelId: "P1", sessionIds: ["S1"], createdAt: 10, updatedAt: 20 },
        { panelId: "P2", sessionIds: [], createdAt: 30, updatedAt: 40 },
      ],
    };
    sm.hydrateLivePanels(rec);
    const out = sm.getLiveEditorPanelsRecord();
    expect(out.panels.map((p) => p.panelId).sort()).toEqual(["P1", "P2"]);
    sm.dispose();
  });

  it("clears the map when given undefined or a wrong-version record", () => {
    const sm = new SessionManager(undefined, { restoreEnabled: true });
    sm.registerEditorPanel("P_old");
    sm.hydrateLivePanels(undefined);
    expect(sm.getLiveEditorPanelsRecord().panels).toEqual([]);
    sm.dispose();
  });
});
