// src/providers/webviewRequests.test.ts — direct test for the shared request
// mechanics (share-provider-request-mechanics OBL-1, OBL-2, OBL-3).
//
// The handler-level rows (OBL-4/5/7/8) are pinned in task 2_3, once the shared
// handlers exist. Provider WIRING is a separate claim entirely and lives in
// providerRequestWiring.test.ts — a green module test here says nothing about
// which post function or log label a provider was handed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { resolveClaudeSession } from "../session/resolveClaudeSession";
import type { SessionManager } from "../session/SessionManager";
import { __resetAll, CancellationTokenSource } from "../test/__mocks__/vscode";
import type { ExtensionToWebViewMessage, WebViewToExtensionMessage } from "../types/messages";
import { resolveSubagentDetail, resolveSubagentDetailByEntryId } from "../vault/readers/subagentLookup";
import type { VaultService } from "../vault/VaultService";
import { previewFileLink } from "./previewFileLink";
import {
  handleFilePreviewRequest,
  handleSubagentPreviewRequest,
  handleVaultSessionsRequest,
  PreviewTokenRegistry,
  postOnce,
  postWithRetry,
} from "./webviewRequests";

vi.mock("./previewFileLink", () => ({ previewFileLink: vi.fn() }));
vi.mock("../session/resolveClaudeSession", () => ({ resolveClaudeSession: vi.fn() }));
vi.mock("../vault/readers/subagentLookup", () => ({
  resolveSubagentDetail: vi.fn(),
  resolveSubagentDetailByEntryId: vi.fn(),
}));

beforeEach(() => {
  __resetAll();
  vi.restoreAllMocks();
});

const MSG = { type: "vaultSessionsResponse" } as unknown as ExtensionToWebViewMessage;

/** A webview whose per-attempt outcome the test scripts. */
function webviewReturning(...outcomes: Array<boolean | "throw">) {
  let call = 0;
  const postMessage = vi.fn(() => {
    const outcome = outcomes[Math.min(call, outcomes.length - 1)];
    call += 1;
    if (outcome === "throw") {
      throw new Error("disposed");
    }
    return Promise.resolve(outcome);
  });
  return { webview: { postMessage } as unknown as vscode.Webview, postMessage };
}

describe("postOnce", () => {
  it("swallows a synchronous throw", () => {
    const { webview, postMessage } = webviewReturning("throw");

    expect(() => postOnce(webview, MSG)).not.toThrow();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("swallows an async rejection and never retries", async () => {
    const postMessage = vi.fn(() => Promise.reject(new Error("disposed")));
    const webview = { postMessage } as unknown as vscode.Webview;

    postOnce(webview, MSG);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});

describe("postWithRetry", () => {
  it("stops at the first success", async () => {
    const { webview, postMessage } = webviewReturning(true);

    await expect(postWithRetry(webview, MSG)).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("makes three attempts by default before giving up", async () => {
    const { webview, postMessage } = webviewReturning(false);

    await expect(postWithRetry(webview, MSG)).resolves.toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(3);
  });

  it("bails before EVERY attempt, including after the retry sleep", async () => {
    // OBL-3. The abort flips while the 50 ms sleep is in progress, which is
    // exactly the window a check hoisted out of the loop would miss.
    const { webview, postMessage } = webviewReturning(false);
    let aborted = false;
    setTimeout(() => {
      aborted = true;
    }, 20);

    await expect(postWithRetry(webview, MSG, 2, () => aborted)).resolves.toBe(false);

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not post at all when the caller is already superseded", async () => {
    const { webview, postMessage } = webviewReturning(true);

    await expect(postWithRetry(webview, MSG, 2, () => true)).resolves.toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("PreviewTokenRegistry", () => {
  it("supersedes the prior request and leaves the newer entry reachable", () => {
    // OBL-1. `end` for the superseded A must not drop B's entry, or a later
    // cancel would find nothing and B's stale result would win.
    const registry = new PreviewTokenRegistry();

    const a = registry.begin("s1");
    const b = registry.begin("s1");
    registry.end("s1", a);
    registry.cancel("s1");

    // Only B is asserted: `begin(b)` already cancelled A, so an A assertion
    // here would hold under the mutation too (review round-1 chair note).
    expect(b.token.isCancellationRequested).toBe(true);
  });

  it("cancel does not dispose", () => {
    // OBL-2, first half. Asserted on the dispose CALL COUNT: the VS Code double
    // keeps `isCancellationRequested` readable after disposal on purpose
    // (src/test/__mocks__/vscode.ts:53), so a readability assertion here would
    // pass whether or not `cancel` disposed.
    //
    // The second half — that the owning handler DOES dispose, exactly once —
    // cannot be established here: a `source.dispose()` call written by the test
    // would be the only thing the spy ever saw (review round-1 F002). It is
    // asserted against the real handler in `handleFilePreviewRequest` below.
    const registry = new PreviewTokenRegistry();
    const disposeSpy = vi.spyOn(CancellationTokenSource.prototype, "dispose");

    registry.begin("s1");
    registry.cancel("s1");

    expect(disposeSpy).toHaveBeenCalledTimes(0);
  });

  it("cancelAll cancels every session present on entry", () => {
    const registry = new PreviewTokenRegistry();
    const a = registry.begin("s1");
    const b = registry.begin("s2");

    registry.cancelAll();

    expect(a.token.isCancellationRequested).toBe(true);
    expect(b.token.isCancellationRequested).toBe(true);
  });

  it("end is a no-op once the entry belongs to a newer request", () => {
    const registry = new PreviewTokenRegistry();
    const a = registry.begin("s1");
    const b = registry.begin("s1");

    registry.end("s1", a);
    registry.end("s1", b);
    registry.cancel("s1");

    // b was ended by its own owner, so the registry holds nothing to cancel.
    expect(b.token.isCancellationRequested).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The shared handlers (task 2_3). These pin the MODULE halves of OBL-4, OBL-5,
// OBL-7 and OBL-8; the wiring halves — which post function and which log label
// each provider is handed — live in providerRequestWiring.test.ts and cannot be
// established from here.

/** A webview whose every post fails, so retry attempts are countable. */
function failingWebview() {
  const postMessage = vi.fn((_message: { type?: string; fromCache?: boolean }) => Promise.resolve(false));
  return { webview: { postMessage } as unknown as vscode.Webview, postMessage };
}

/** Long enough for two real 50 ms retry sleeps. */
const settleRetries = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300));

const sessionManagerStub = {
  getSession: () => ({ pty: { pid: 1 } }),
  getInitialCwd: () => "/repo",
  getCurrentCwd: () => "/repo",
  getLiveCwd: async () => "/repo",
} as unknown as SessionManager;

describe("handleSubagentPreviewRequest", () => {
  // OBL-4 module half. Each of the four reply branches must honour the injected
  // post — a handler that reached for one of them directly would make the
  // editor and the view indistinguishable here.
  const branches: Array<{ name: string; message: WebViewToExtensionMessage; arrange: () => void }> = [
    {
      name: "nested drill-down",
      message: {
        type: "requestSubagentPreview",
        terminalId: "t1",
        requestId: "r",
        description: "d",
        entryId: "e1",
        x: 0,
        y: 0,
      },
      arrange: () => {
        vi.mocked(resolveSubagentDetailByEntryId).mockResolvedValue({ messages: [] } as never);
      },
    },
    {
      name: "no live session",
      message: { type: "requestSubagentPreview", terminalId: "t1", requestId: "r", description: "d", x: 0, y: 0 },
      arrange: () => {
        vi.mocked(resolveClaudeSession).mockResolvedValue(undefined as never);
      },
    },
    {
      name: "detail resolved",
      message: { type: "requestSubagentPreview", terminalId: "t1", requestId: "r", description: "d", x: 0, y: 0 },
      arrange: () => {
        vi.mocked(resolveClaudeSession).mockResolvedValue({ sessionId: "s1", cwd: "/repo" } as never);
        vi.mocked(resolveSubagentDetail).mockResolvedValue({ messages: [] } as never);
      },
    },
    {
      name: "read error",
      message: {
        type: "requestSubagentPreview",
        terminalId: "t1",
        requestId: "r",
        description: "d",
        entryId: "e1",
        x: 0,
        y: 0,
      },
      arrange: () => {
        vi.mocked(resolveSubagentDetailByEntryId).mockRejectedValue(new Error("boom"));
      },
    },
  ];

  for (const branch of branches) {
    it(`posts once under postOnce — ${branch.name}`, async () => {
      branch.arrange();
      const { webview, postMessage } = failingWebview();

      await handleSubagentPreviewRequest(branch.message as never, {
        sessionManager: sessionManagerStub,
        post: (msg) => postOnce(webview, msg),
      });
      await settleRetries();

      expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it(`retries under postWithRetry — ${branch.name}`, async () => {
      branch.arrange();
      const { webview, postMessage } = failingWebview();

      await handleSubagentPreviewRequest(branch.message as never, {
        sessionManager: sessionManagerStub,
        post: (msg) => {
          void postWithRetry(webview, msg);
        },
      });
      await settleRetries();

      expect(postMessage).toHaveBeenCalledTimes(3);
    });
  }
});

describe("handleVaultSessionsRequest", () => {
  const vaultWith = (overrides: Partial<VaultService>): VaultService => overrides as VaultService;

  it("posts the cache once and retries only the fresh list", async () => {
    // OBL-5. A retried cache post could land after the fresh one and make a
    // stale list win, so the two phases must not share a delivery policy.
    const { webview, postMessage } = failingWebview();
    await handleVaultSessionsRequest({
      webview,
      vaultService: vaultWith({
        listCached: () => ({ entries: [], unreadable: { count: 0, reasons: [] } }) as never,
        refresh: async () => ({ entries: [], unreadable: { count: 0, reasons: [] } }) as never,
      }),
      isCurrent: () => true,
      logSuffix: "",
    });
    await settleRetries();

    const posts = postMessage.mock.calls.map(([m]) => m as unknown as { fromCache?: boolean });
    expect(posts.filter((m) => m.fromCache === true)).toHaveLength(1);
    expect(posts.filter((m) => m.fromCache === false)).toHaveLength(3);
  });

  it("labels the vault-list failure with the caller's suffix and nothing else", async () => {
    // OBL-8 module half.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vaultWith({
      listCached: () => null,
      refresh: async () => {
        throw new Error("boom");
      },
    });
    const { webview } = failingWebview();

    await handleVaultSessionsRequest({ webview, vaultService: failing, isCurrent: () => true, logSuffix: " (editor)" });
    await handleVaultSessionsRequest({ webview, vaultService: failing, isCurrent: () => true, logSuffix: "" });
    await settleRetries();

    const messages = spy.mock.calls.map(([m]) => m);
    expect(messages).toContain("[AnyWhere Terminal] Failed to list vault sessions (editor):");
    expect(messages).toContain("[AnyWhere Terminal] Failed to list vault sessions:");
  });
});

describe("handleFilePreviewRequest", () => {
  const PREVIEW_MSG = {
    type: "requestFilePreview",
    sessionId: "s1",
    requestId: "r1",
    text: "src/a.ts",
  } as unknown as Extract<WebViewToExtensionMessage, { type: "requestFilePreview" }>;

  it("drops a result whose request was cancelled while it resolved", async () => {
    // OBL-7. The webview has already invalidated this requestId; posting the
    // superseded preview would render it anyway.
    const tokens = new PreviewTokenRegistry();
    const { webview, postMessage } = failingWebview();
    vi.mocked(previewFileLink).mockImplementation(async () => {
      // A newer request for the same session arrives mid-resolve.
      tokens.cancel("s1");
      return { type: "filePreviewResponse", requestId: "r1" } as never;
    });

    await handleFilePreviewRequest(PREVIEW_MSG, {
      webview,
      sessionManager: sessionManagerStub,
      tokens,
      logSuffix: "",
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("disposes its own source exactly once, in its own finally", async () => {
    // OBL-2, second half — the one the registry test cannot make. The spy is on
    // the constructor's prototype, so every call it records came from
    // production code; a `dispose()` written by this test would be
    // indistinguishable and is deliberately absent (review round-1 F002).
    const disposeSpy = vi.spyOn(CancellationTokenSource.prototype, "dispose");
    vi.mocked(previewFileLink).mockResolvedValue({ type: "filePreviewResponse", requestId: "r1" } as never);
    const { webview } = failingWebview();

    await handleFilePreviewRequest(PREVIEW_MSG, {
      webview,
      sessionManager: sessionManagerStub,
      tokens: new PreviewTokenRegistry(),
      logSuffix: "",
    });

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("still disposes when the request threw", async () => {
    const disposeSpy = vi.spyOn(CancellationTokenSource.prototype, "dispose");
    vi.mocked(previewFileLink).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { webview } = failingWebview();

    await handleFilePreviewRequest(PREVIEW_MSG, {
      webview,
      sessionManager: sessionManagerStub,
      tokens: new PreviewTokenRegistry(),
      logSuffix: "",
    });

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("posts a result that was never cancelled", async () => {
    // The companion to the row above: without this, dropping every post would
    // also satisfy it.
    const tokens = new PreviewTokenRegistry();
    const { webview, postMessage } = failingWebview();
    vi.mocked(previewFileLink).mockResolvedValue({ type: "filePreviewResponse", requestId: "r1" } as never);

    await handleFilePreviewRequest(PREVIEW_MSG, {
      webview,
      sessionManager: sessionManagerStub,
      tokens,
      logSuffix: "",
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("labels the preview failure with the caller's suffix and nothing else", async () => {
    // OBL-8 module half.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(previewFileLink).mockRejectedValue(new Error("boom"));
    const { webview } = failingWebview();

    await handleFilePreviewRequest(PREVIEW_MSG, {
      webview,
      sessionManager: sessionManagerStub,
      tokens: new PreviewTokenRegistry(),
      logSuffix: " (editor)",
    });
    await handleFilePreviewRequest(PREVIEW_MSG, {
      webview,
      sessionManager: sessionManagerStub,
      tokens: new PreviewTokenRegistry(),
      logSuffix: "",
    });

    const messages = spy.mock.calls.map(([m]) => m);
    expect(messages).toContain("[AnyWhere Terminal] requestFilePreview failed (editor):");
    expect(messages).toContain("[AnyWhere Terminal] requestFilePreview failed:");
  });
});
