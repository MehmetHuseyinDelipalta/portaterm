// @vitest-environment jsdom
// src/webview/main.closeRootPane.test.ts — a split tab whose ROOT pane was
// closed must still close as a whole.
//
// "Close Pane" on a tab's root leaf keeps the tab, now showing its split, under
// the root's id — but the root's own terminal is gone. `removeTerminal` keyed
// its teardown on that terminal, so the tab's close (`tabRemoved`) returned
// early: the split's xterm, its layout and its PTY stayed behind, and after a
// reload the PTY was alive with no tab to show it. This boots the real
// `main.ts` in the real webview HTML and drives that sequence.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { getTerminalHtml } from "../providers/webviewHtml";

// Every test re-imports the whole webview bundle entry; under a loaded full-suite
// run that cold import alone can pass the 5s default (seen at load ~11).
vi.setConfig({ testTimeout: 30_000 });

// ─── xterm stand-in ─────────────────────────────────────────────────
// Records each terminal's onData and private onUserInput listeners so a test
// can emit "typed" chunks (user-input flag, then data) and xterm's own replies.

const xterm = vi.hoisted(() => {
  const byElement = new Map<Element, { data?: (d: string) => void; userInput?: () => void }>();
  const all: Array<{ container?: Element; data?: (d: string) => void; userInput?: () => void; disposed?: boolean }> =
    [];

  class FakeTerminal {
    element: HTMLDivElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown> = {};
    rows = 24;
    cols = 80;
    modes = { bracketedPasteMode: false };
    buffer = {
      active: { cursorY: 0, cursorX: 0, length: 0, getLine: () => undefined, viewportY: 0, baseY: 0, type: "normal" },
      onBufferChange: () => ({ dispose: () => {} }),
    };
    parser = {
      registerOscHandler: () => ({ dispose: () => {} }),
      registerCsiHandler: () => ({ dispose: () => {} }),
      registerDcsHandler: () => ({ dispose: () => {} }),
      registerEscHandler: () => ({ dispose: () => {} }),
    };
    unicode = { activeVersion: "6" };
    private readonly handle: {
      container?: Element;
      data?: (d: string) => void;
      userInput?: () => void;
      disposed?: boolean;
    } = {};
    _core = {
      coreService: {
        onUserInput: (listener: () => void) => {
          this.handle.userInput = listener;
          return { dispose: () => {} };
        },
      },
    };
    constructor() {
      all.push(this.handle);
    }
    open(container: HTMLElement) {
      this.element = document.createElement("div");
      this.textarea = document.createElement("textarea");
      this.textarea.className = "xterm-helper-textarea"; // what real xterm calls its input
      this.element.appendChild(this.textarea);
      container.appendChild(this.element);
      this.handle.container = container;
      byElement.set(container, this.handle);
    }
    loadAddon() {}
    focus() {}
    blur() {}
    resize() {}
    write(_d: unknown, cb?: () => void) {
      cb?.();
    }
    writeln() {}
    clear() {}
    reset() {}
    refresh() {}
    scrollToBottom() {}
    select() {}
    selectAll() {}
    clearSelection() {}
    hasSelection() {
      return false;
    }
    getSelection() {
      return "";
    }
    dispose() {
      this.handle.disposed = true;
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
    registerLinkProvider() {
      return { dispose: () => {} };
    }
    registerMarker() {
      return undefined;
    }
    registerDecoration() {
      return undefined;
    }
    onData(listener: (d: string) => void) {
      this.handle.data = listener;
      return { dispose: () => {} };
    }
    onResize() {
      return { dispose: () => {} };
    }
    onTitleChange() {
      return { dispose: () => {} };
    }
    onWriteParsed() {
      return { dispose: () => {} };
    }
    onRender() {
      return { dispose: () => {} };
    }
    onScroll() {
      return { dispose: () => {} };
    }
    onSelectionChange() {
      return { dispose: () => {} };
    }
    onBell() {
      return { dispose: () => {} };
    }
    onKey() {
      return { dispose: () => {} };
    }
    onLineFeed() {
      return { dispose: () => {} };
    }
    onCursorMove() {
      return { dispose: () => {} };
    }
  }
  return { FakeTerminal, byElement, all };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    onDidChangeResults() {
      return { dispose: () => {} };
    }
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

// ─── Harness ────────────────────────────────────────────────────────

let posted: Array<{ type: string; [key: string]: unknown }> = [];

// `main.ts` installs its listeners on the long-lived window and document. Each
// test boots a fresh copy, so the previous copy's listeners are removed after
// every test — otherwise two webviews would answer one message.
const installed: Array<[EventTarget, string, EventListenerOrEventListenerObject, unknown]> = [];
for (const target of [window, document] as EventTarget[]) {
  const add = target.addEventListener.bind(target);
  target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    installed.push([target, type, listener, options]);
    add(type, listener, options as AddEventListenerOptions);
  };
}

function host(msg: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: msg }));
}

/** The fake terminal mounted for `sessionId`, found through its container's context. */
function paneHandle(sessionId: string) {
  for (const handle of xterm.all) {
    const context = (handle.container as HTMLElement | undefined)?.dataset.vscodeContext;
    if (context && JSON.parse(context).paneSessionId === sessionId) {
      return handle as { container: HTMLElement; disposed?: boolean };
    }
  }
  throw new Error(`no terminal mounted for ${sessionId}`);
}

async function bootWithSplit() {
  const html = getTerminalHtml(
    { cspSource: "mock", asWebviewUri: (u: { fsPath: string }) => u.fsPath } as never,
    vscode.Uri.file("/ext"),
    "sidebar",
  );
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html")
    .documentElement.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "");
  await import("./main");
  host({
    type: "init",
    tabs: [{ id: "t1", name: "Terminal 1", customName: null, isActive: true, isSplitPane: false }],
    config: { fontSize: 14, cursorBlink: false, scrollback: 1000, fontFamily: "" },
    rootGeneration: 0,
    workspaceRoot: null,
    resolvedWorkspaceRoot: null,
    worktreeHasRepo: false,
    worktreeRowActivation: "focus",
    vaultActionsAvailable: true,
  });
  await split("p2", 2);
  posted = [];
}

/** Split t1's active pane the way the host does: request, then the created session. */
async function split(newSessionId: string, expectedLeaves: number): Promise<void> {
  posted = [];
  host({ type: "splitPane", direction: "vertical" });
  const request = posted.find((m) => m.type === "requestSplitSession");
  if (!request) {
    throw new Error("splitPane posted no requestSplitSession");
  }
  host({
    type: "splitPaneCreated",
    requestId: request.requestId,
    sourceTabId: "t1",
    sourcePaneId: request.sourcePaneId,
    newSessionId,
    newSessionName: newSessionId,
    direction: "vertical",
  });
  await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(expectedLeaves));
}

beforeEach(() => {
  vi.resetModules();
  xterm.all.length = 0;
  posted = [];
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (m: { type: string }) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as never;
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  for (const [target, type, listener, options] of installed.splice(0)) {
    target.removeEventListener(type, listener, options as EventListenerOptions);
  }
  vi.restoreAllMocks();
});

const tabItem = (id: string) => document.querySelector<HTMLElement>(`#tab-bar .tab-item[data-tab-id="${id}"]`);
const tabContainer = (id: string) => document.querySelector<HTMLElement>(`#terminal-container [data-tab-id="${id}"]`);
const leafIds = () =>
  [...document.querySelectorAll<HTMLElement>(".split-leaf")].map((el) => el.dataset.sessionId).sort();

/** Close t1's ROOT pane the way the host's gated Close Pane does. */
async function closeRootPane(): Promise<void> {
  host({ type: "closeSplitPaneById", sessionId: "t1" });
  await vi.waitFor(() => expect(leafIds()).toEqual(["p2"]));
}

describe("closing a split tab whose root pane was closed first", () => {
  it("keeps the tab, showing its split, after the root pane closes", async () => {
    await bootWithSplit();
    await closeRootPane();

    expect(posted).toContainEqual({ type: "requestCloseSplitPane", sessionId: "t1" });

    expect(tabItem("t1")).not.toBeNull();
    expect(paneHandle("p2").disposed).toBeUndefined();
  });

  it("tears the whole tab down on tabRemoved: split xterm, layout, tab and its PTY", async () => {
    await bootWithSplit();
    await closeRootPane();
    posted = [];

    host({ type: "tabRemoved", tabId: "t1" });

    await vi.waitFor(() => expect(tabItem("t1")).toBeNull());
    expect(leafIds()).toEqual([]);
    expect(tabContainer("t1")).toBeNull();
    expect(paneHandle("p2").disposed).toBe(true);
    // The split's PTY is the host's to destroy; the webview asks for it.
    expect(posted).toContainEqual({ type: "requestCloseSplitPane", sessionId: "p2" });
  });

  it("the tab's × still asks the host to close the tab", async () => {
    await bootWithSplit();
    await closeRootPane();
    posted = [];

    tabItem("t1")!.querySelector<HTMLElement>(".tab-close")!.click();

    expect(posted).toContainEqual({ type: "closeTab", tabId: "t1" });
  });

  it("ignores tabRemoved for a tab it does not hold", async () => {
    await bootWithSplit();
    posted = [];

    host({ type: "tabRemoved", tabId: "nope" });

    expect(leafIds()).toEqual(["p2", "t1"]);
    expect(tabItem("t1")).not.toBeNull();
    expect(posted.filter((m) => m.type === "requestCloseSplitPane")).toEqual([]);
  });

  it("shows the tab's name and pin, which the host hands to the surviving split under the tab id", async () => {
    await bootWithSplit();
    await closeRootPane();

    host({ type: "tabRenamed", tabId: "t1", customName: "build" });
    host({ type: "tabPinned", tabId: "t1", pinned: true });

    await vi.waitFor(() => expect(tabItem("t1")?.getAttribute("aria-label")).toBe("build"));
    expect(tabItem("t1")!.querySelector<HTMLElement>(".tab-close")!.hidden).toBe(true);
  });
});
