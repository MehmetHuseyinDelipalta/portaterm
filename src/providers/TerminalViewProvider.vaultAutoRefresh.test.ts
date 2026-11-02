// src/providers/TerminalViewProvider.vaultAutoRefresh.test.ts — a store event
// that changed no row posts nothing (perf B7): the watcher-driven refresh skips
// its post when the webview already shows that exact list and nothing else
// posted a list since.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

vi.mock("../pty/PtyManager", () => ({
  loadNodePty: vi.fn(() => ({ spawn: vi.fn() })),
  detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: [] })),
  buildEnvironment: vi.fn(() => ({})),
  resolveWorkingDirectory: vi.fn(() => "/tmp"),
}));
vi.mock("../pty/PtySession", () => ({ PtySession: class {} }));
vi.mock("../session/OutputBuffer", () => ({ OutputBuffer: class {} }));

import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import type { VaultRefreshHint } from "../vault/cacheTypes";
import type { VaultListResult } from "../vault/types";
import type { VaultService } from "../vault/VaultService";
import { TerminalViewProvider } from "./TerminalViewProvider";
import type { VaultWatchCoordinator } from "./VaultWatchCoordinator";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const list = (title: string): VaultListResult => ({
  entries: [{ id: "claude:c1", agent: "claude", sessionId: "c1", title, cwd: "/x", modified: 1, flags: {} }],
  unreadable: { count: 0, reasons: [] },
});

function webviewViewFor(postMessage: ReturnType<typeof vi.fn>, handlers: Array<(msg: unknown) => void>) {
  return {
    visible: true,
    viewType: "portaterm.sidebar",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (h: (msg: unknown) => void) => {
        handlers.push(h);
        return { dispose: () => {} };
      },
      postMessage,
    },
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewView;
}

const listTitles = (postMessage: ReturnType<typeof vi.fn>) =>
  postMessage.mock.calls
    .map(([m]) => m as { type?: string; result?: VaultListResult })
    .filter((m) => m.type === "vaultSessionsResponse")
    .map((m) => m.result?.entries[0]?.title);

function mount(refresh: ReturnType<typeof vi.fn>) {
  const sm = new SessionManager();
  let refreshList: (hint?: VaultRefreshHint) => void = () => {};
  const coordinator = {
    attach: (callbacks: { refreshList: (hint?: VaultRefreshHint) => void }) => {
      refreshList = callbacks.refreshList;
      return { watchSession: async () => {}, setDisplayed: () => {}, dispose: () => {} };
    },
  };
  const vault = {
    refresh,
    listCached: vi.fn(() => null),
    preloadCache: vi.fn(async () => {}),
    writeNativeTitle: vi.fn(),
    setCustomName: vi.fn(),
  };
  const provider = new TerminalViewProvider(
    { fsPath: "/mock/extension" } as vscode.Uri,
    sm,
    "sidebar",
    null,
    null,
    vault as unknown as VaultService,
    null,
    coordinator as unknown as VaultWatchCoordinator,
  );
  const handlers: Array<(msg: unknown) => void> = [];
  const postMessage = vi.fn((_message: unknown) => Promise.resolve(true));
  const resolve = (view: vscode.WebviewView) =>
    provider.resolveWebviewView(view, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
  resolve(webviewViewFor(postMessage, handlers));
  return {
    sm,
    vault,
    postMessage,
    listPosts: () => listTitles(postMessage),
    /** Resolve the view again, as VS Code does after it disposed the old one. */
    reopen: () => {
      const next = vi.fn((_message: unknown) => Promise.resolve(true));
      resolve(webviewViewFor(next, []));
      return next;
    },
    storeEvent: () => refreshList({ agent: "claude", paths: ["/p/c1.jsonl"] }),
    send: (msg: unknown) => {
      for (const h of handlers) {
        h(msg);
      }
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("watcher-driven vault list refresh", () => {
  it("posts a list once, and not again while it stays the same", async () => {
    const refresh = vi.fn(async () => list("same"));
    const { storeEvent, listPosts, sm } = mount(refresh);
    storeEvent();
    await settle();
    storeEvent();
    await settle();
    storeEvent();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(listPosts()).toEqual(["same"]);
    sm.dispose();
  });

  it("posts a list that changed", async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(list("one"))
      .mockResolvedValueOnce(list("one"))
      .mockResolvedValueOnce(list("two"));
    const { storeEvent, listPosts, sm } = mount(refresh);
    for (let i = 0; i < 3; i++) {
      storeEvent();
      await settle();
    }
    expect(listPosts()).toEqual(["one", "two"]);
    sm.dispose();
  });

  it("posts the same list again after another request posted a list in between", async () => {
    const refresh = vi.fn(async () => list("same"));
    const { storeEvent, listPosts, send, sm } = mount(refresh);
    storeEvent();
    await settle();
    send({ type: "requestVaultSessions" });
    await settle();
    storeEvent();
    await settle();
    expect(listPosts()).toEqual(["same", "same", "same"]);
    sm.dispose();
  });

  it("posts the same list again when the last post did not reach the webview", async () => {
    const refresh = vi.fn(async () => list("same"));
    const { storeEvent, listPosts, postMessage, sm } = mount(refresh);
    postMessage.mockImplementation(() => Promise.resolve(false));
    storeEvent();
    // The first try and both retries (50 ms apart) all fail, and the post gives up.
    await vi.waitFor(() => expect(listPosts()).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 20));
    const attempts = listPosts().length;
    postMessage.mockImplementation(() => Promise.resolve(true));
    storeEvent();
    await settle();
    expect(listPosts()).toHaveLength(attempts + 1);
    storeEvent();
    await settle();
    expect(listPosts()).toHaveLength(attempts + 1); // delivered now: skipped
    sm.dispose();
  });

  it("posts the same list to a view resolved again with a new webview", async () => {
    const refresh = vi.fn(async () => list("same"));
    const { storeEvent, listPosts, reopen, sm } = mount(refresh);
    storeEvent();
    await settle();
    const fresh = reopen();
    storeEvent();
    await settle();
    expect(listPosts()).toEqual(["same"]);
    expect(listTitles(fresh)).toEqual(["same"]);
    sm.dispose();
  });

  it("does not let an older refresh that a newer one overtook decide what was shown", async () => {
    let releaseFirst: (r: VaultListResult) => void = () => {};
    const refresh = vi
      .fn()
      .mockImplementationOnce(() => new Promise<VaultListResult>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(list("newer"))
      .mockResolvedValue(list("first"));
    const { storeEvent, listPosts, sm } = mount(refresh);
    storeEvent(); // first, held
    storeEvent(); // second, posts "newer"
    await settle();
    releaseFirst(list("first")); // stale: dropped
    await settle();
    storeEvent(); // "first" is not what the webview shows
    await settle();
    expect(listPosts()).toEqual(["newer", "first"]);
    sm.dispose();
  });

  it("starts reading the persisted list while the webview boots (perf B8)", () => {
    const { vault, sm } = mount(vi.fn(async () => list("same")));
    expect(vault.preloadCache).toHaveBeenCalledOnce();
    sm.dispose();
  });
});
