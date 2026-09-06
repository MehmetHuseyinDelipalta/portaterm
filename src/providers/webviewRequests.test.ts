// src/providers/webviewRequests.test.ts — direct test for the shared request
// mechanics (share-provider-request-mechanics OBL-1, OBL-2, OBL-3).
//
// The handler-level rows (OBL-4/5/7/8) are pinned in task 2_3, once the shared
// handlers exist. Provider WIRING is a separate claim entirely and lives in
// providerRequestWiring.test.ts — a green module test here says nothing about
// which post function or log label a provider was handed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { CancellationTokenSource, __resetAll } from "../test/__mocks__/vscode";
import { PreviewTokenRegistry, postOnce, postWithRetry } from "./webviewRequests";

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
    const a = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;
    const b = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;

    registry.begin("s1", a);
    registry.begin("s1", b);
    registry.end("s1", a);
    registry.cancel("s1");

    expect(a.token.isCancellationRequested).toBe(true);
    expect(b.token.isCancellationRequested).toBe(true);
  });

  it("cancels without disposing, leaving disposal to the owning finally", () => {
    // OBL-2. Asserted on the dispose CALL COUNT: the VS Code double keeps
    // `isCancellationRequested` readable after disposal on purpose
    // (src/test/__mocks__/vscode.ts:53), so a readability assertion here would
    // pass whether or not `cancel` disposed.
    const registry = new PreviewTokenRegistry();
    const source = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;
    const disposeSpy = vi.spyOn(source, "dispose");

    registry.begin("s1", source);
    registry.cancel("s1");

    expect(disposeSpy).toHaveBeenCalledTimes(0);

    source.dispose(); // the owning handler's finally
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("cancelAll cancels every session present on entry", () => {
    const registry = new PreviewTokenRegistry();
    const a = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;
    const b = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;
    registry.begin("s1", a);
    registry.begin("s2", b);

    registry.cancelAll();

    expect(a.token.isCancellationRequested).toBe(true);
    expect(b.token.isCancellationRequested).toBe(true);
  });

  it("end is a no-op once the entry belongs to a newer request", () => {
    const registry = new PreviewTokenRegistry();
    const a = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;
    const b = new CancellationTokenSource() as unknown as vscode.CancellationTokenSource;
    registry.begin("s1", a);
    registry.begin("s1", b);

    registry.end("s1", a);
    registry.end("s1", b);
    registry.cancel("s1");

    // b was ended by its own owner, so the registry holds nothing to cancel.
    expect(b.token.isCancellationRequested).toBe(false);
  });
});
