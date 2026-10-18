// src/providers/providerRequestWiring.test.ts — characterization of how each
// provider is WIRED to the request mechanics
// (share-provider-request-mechanics OBL-4, OBL-6, OBL-8).
//
// Written against the pre-extraction providers. A module-level test of the
// shared helpers stays green when a provider is handed the wrong posting
// function or the wrong log label, so those claims can only be witnessed here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import * as vscodeApi from "../test/__mocks__/vscode";
import { __resetAll } from "../test/__mocks__/vscode";
import { pumpTimeoutMacrotasks } from "../test/providerTestUtils";
import type { VaultListResult } from "../vault/types";
import type { VaultService } from "../vault/VaultService";
import { previewFileLink } from "./previewFileLink";
import { TerminalEditorProvider } from "./TerminalEditorProvider";
import { TerminalViewProvider } from "./TerminalViewProvider";

vi.mock("./previewFileLink", () => ({ previewFileLink: vi.fn() }));

beforeEach(() => {
  __resetAll();
  vi.restoreAllMocks();
});

const settle = (): Promise<void> => pumpTimeoutMacrotasks(12);

function listResult(...ids: string[]): VaultListResult {
  return {
    entries: ids.map((id) => ({ id, agent: "claude", sessionId: id, title: id, cwd: "/repo" })),
    unreadable: { count: 0, reasons: [] },
  } as unknown as VaultListResult;
}

/** A webview whose every post fails, so retry attempts are countable. */
function failingWebview() {
  const handlers: Array<(msg: unknown) => void> = [];
  const postMessage = vi.fn((_message: { type?: string; result?: VaultListResult }) => Promise.resolve(false));
  const webview = {
    html: "",
    options: {},
    cspSource: "https://mock.csp.source",
    asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
    onDidReceiveMessage: (h: (msg: unknown) => void) => {
      handlers.push(h);
      return { dispose: () => {} };
    },
    postMessage,
  };
  return { webview, handlers, postMessage };
}

function mountEditor(vault: Partial<VaultService> | null) {
  const { webview, handlers, postMessage } = failingWebview();
  const panel = {
    visible: true,
    active: true,
    viewColumn: 1,
    title: "Terminal",
    webview,
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
  const sessions = new SessionManager();
  vi.spyOn(vscodeApi.window, "createWebviewPanel").mockReturnValue(panel as never);
  TerminalEditorProvider.createPanel(
    { extensionUri: { fsPath: "/mock/extension" }, subscriptions: [] } as unknown as vscode.ExtensionContext,
    sessions,
    null,
    null,
    null,
    null,
    vault as VaultService | null,
  );
  return {
    send: (msg: unknown) => {
      for (const h of handlers) {
        h(msg);
      }
    },
    postsOf: (type: string) => postMessage.mock.calls.filter(([m]) => m.type === type),
    dispose: () => sessions.dispose(),
  };
}

function mountView(vault: Partial<VaultService> | null) {
  const { webview, handlers, postMessage } = failingWebview();
  const webviewView = {
    webview,
    visible: true,
    show: vi.fn(),
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewView;
  const sessions = new SessionManager();
  const provider = new TerminalViewProvider(
    { fsPath: "/mock/extension" } as vscode.Uri,
    sessions,
    "sidebar",
    null,
    null,
    vault as VaultService | null,
  );
  provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
  const send = (msg: unknown) => {
    for (const h of handlers) {
      h(msg);
    }
  };
  send({ type: "ready" });
  return {
    send,
    postsOf: (type: string) => postMessage.mock.calls.filter(([m]) => m.type === type),
    dispose: () => sessions.dispose(),
  };
}

describe("OBL-4: the subagent-preview posting asymmetry is a wiring fact", () => {
  it("the editor surface posts each reply once", async () => {
    const surface = mountEditor(null);
    surface.send({ type: "requestSubagentPreview", terminalId: "nope", requestId: "r1", description: "d" });
    // Must outlast two 50 ms retry sleeps: waiting only a few macrotasks would
    // report one attempt whether or not the editor was wired to the retry.
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    expect(surface.postsOf("subagentPreviewResponse")).toHaveLength(1);
    surface.dispose();
  });

  it("the view surface retries each reply", async () => {
    // Two real 50 ms sleeps separate the three attempts. Fake timers do not work
    // here — the retry loop interleaves them with promise resolutions the fake
    // clock does not drive.
    const surface = mountView(null);
    surface.send({ type: "requestSubagentPreview", terminalId: "nope", requestId: "r1", description: "d" });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    expect(surface.postsOf("subagentPreviewResponse")).toHaveLength(3);
    surface.dispose();
  });
});

describe("OBL-8: each provider's log strings are a wiring fact", () => {
  it("the editor tags its vault-list failure with (editor)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const surface = mountEditor({
      listCached: () => undefined,
      refresh: async () => {
        throw new Error("boom");
      },
    } as unknown as Partial<VaultService>);
    surface.send({ type: "requestVaultSessions" });
    await settle();

    expect(spy.mock.calls.map(([m]) => m)).toContain("[Portaterm] Failed to list vault sessions (editor):");
    surface.dispose();
  });

  it("the view does not", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const surface = mountView({
      listCached: () => undefined,
      refresh: async () => {
        throw new Error("boom");
      },
    } as unknown as Partial<VaultService>);
    surface.send({ type: "requestVaultSessions" });
    await settle();

    const messages = spy.mock.calls.map(([m]) => m);
    expect(messages).toContain("[Portaterm] Failed to list vault sessions:");
    expect(messages).not.toContain("[Portaterm] Failed to list vault sessions (editor):");
    surface.dispose();
  });
});

describe("OBL-8: the file-preview log label is a wiring fact too", () => {
  // Round-1 F001. Without these two, a provider handed the OTHER provider's
  // `logSuffix` for file preview passes every test in the repository: the
  // module test supplies the label itself, so it cannot see a swap.
  const PREVIEW = { type: "requestFilePreview", path: "src/a.ts", sessionId: "s1", requestId: "r1" };

  /** The handler returns early on an unknown session, before it can log. */
  function withSession(): void {
    vi.spyOn(SessionManager.prototype, "getSession").mockReturnValue({ id: "s1" } as never);
    vi.mocked(previewFileLink).mockRejectedValue(new Error("boom"));
  }

  it("the editor tags its preview failure with (editor)", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    withSession();
    const surface = mountEditor(null);

    surface.send(PREVIEW);
    await settle();

    const messages = spy.mock.calls.map(([m]) => m);
    expect(messages).toContain("[Portaterm] requestFilePreview failed (editor):");
    expect(messages).not.toContain("[Portaterm] requestFilePreview failed:");
    surface.dispose();
  });

  it("the view does not", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    withSession();
    const surface = mountView(null);

    surface.send(PREVIEW);
    await settle();

    const messages = spy.mock.calls.map(([m]) => m);
    expect(messages).toContain("[Portaterm] requestFilePreview failed:");
    expect(messages).not.toContain("[Portaterm] requestFilePreview failed (editor):");
    surface.dispose();
  });
});

describe("OBL-6: one _vaultRefreshSeq, shared with the rename push", () => {
  it("a rename during an in-flight refresh drops the older list", async () => {
    // The rename push increments the same counter the request holds. A second
    // counter in a shared module would let this stale list win.
    let release: (v: VaultListResult) => void = () => {};
    let call = 0;
    const surface = mountView({
      listCached: () => undefined,
      // First call is the request's refresh and stays pending; every later call
      // is the rename push's own, which must be the one that lands.
      refresh: vi.fn(() => {
        call += 1;
        return call === 1
          ? new Promise<VaultListResult>((resolve) => (release = resolve))
          : Promise.resolve(listResult("claude:renamed"));
      }),
      setCustomName: vi.fn(),
    } as unknown as Partial<VaultService>);

    surface.send({ type: "requestVaultSessions" });
    await settle();
    surface.send({ type: "vaultRenameSession", entryId: "claude:x", name: "renamed" });
    await settle();
    release(listResult("claude:stale"));
    await settle();

    const delivered = surface
      .postsOf("vaultSessionsResponse")
      .flatMap(([m]) => (m.result?.entries ?? []).map((e) => e.id));
    // Both halves. Without the positive one, a wiring break that delivers
    // NOTHING satisfies the negative assertion too (review round-1 F003).
    expect(delivered).toContain("claude:renamed");
    expect(delivered).not.toContain("claude:stale");
    surface.dispose();
  });
});
