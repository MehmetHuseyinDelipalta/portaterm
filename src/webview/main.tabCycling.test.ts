// @vitest-environment jsdom
// src/webview/main.tabCycling.test.ts — Ctrl+Tab cycles the tabs the bar shows.
//
// It cycled the terminal map, which holds every split PANE too: from a split
// tab the next id was a pane, `switchTab` could not open it, and Ctrl+Tab
// stopped moving. This boots the real `main.ts` with a split tab beside a plain
// one and presses the key the way the user does.

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
      // What real xterm calls its input element: the one textarea whose keys
      // belong to the PTY.
      this.textarea.className = "xterm-helper-textarea";
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
    tabs: [
      { id: "t1", name: "Terminal 1", customName: null, isActive: true, isSplitPane: false },
      { id: "t2", name: "Terminal 2", customName: null, isActive: false, isSplitPane: false },
      // Owned by linked worktree /wt/a: the bar hides them while main is in scope.
      { id: "t3", name: "Wt 1", customName: null, isActive: false, isSplitPane: false, worktreeId: "/wt/a" },
      { id: "t4", name: "Wt 2", customName: null, isActive: false, isSplitPane: false, worktreeId: "/wt/a" },
    ],
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

const activeTab = () => document.querySelector<HTMLElement>("#tab-bar .tab-item.active")?.dataset.tabId;
const barTabs = () => [...document.querySelectorAll<HTMLElement>("#tab-bar .tab-item")].map((el) => el.dataset.tabId);

/**
 * Ctrl+Tab as it arrives with focus in the active pane's xterm input: from
 * the textarea, bubbling. (Real xterm would consume it unless the custom key
 * handler declines it — `InputHandler.test.ts` holds that half.)
 */
function ctrlTab(shiftKey = false): void {
  const tab = document.querySelector<HTMLElement>("#tab-bar .tab-item.active")?.dataset.tabId;
  const container = [...document.querySelectorAll<HTMLElement>("[data-vscode-context]")].find(
    (el) => JSON.parse(el.dataset.vscodeContext ?? "{}").paneSessionId === tab,
  );
  const pane = container?.querySelector<HTMLElement>("textarea.xterm-helper-textarea");
  if (!pane) {
    throw new Error(`no xterm input for the active tab ${tab}`);
  }
  pane.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, shiftKey, bubbles: true, cancelable: true }),
  );
}

describe("Ctrl+Tab in the shipped webview", () => {
  it("moves between a split tab and the next tab, and back, without stopping on a pane", async () => {
    await bootWithSplit();
    expect(activeTab()).toBe("t1");
    expect(barTabs()).toEqual(["t1", "t2"]);

    ctrlTab();
    await vi.waitFor(() => expect(activeTab()).toBe("t2"));
    // The terminal map's next id after t2 is the split pane p2.
    ctrlTab();
    await vi.waitFor(() => expect(activeTab()).toBe("t1"));
    ctrlTab(true);
    await vi.waitFor(() => expect(activeTab()).toBe("t2"));
  });

  it("cycles the tabs of the worktree in scope, not main's", async () => {
    await bootWithSplit();
    host({ type: "worktreeActivatePane", paneId: "t3" });
    await vi.waitFor(() => expect(barTabs()).toEqual(["t3", "t4"]));
    expect(activeTab()).toBe("t3");

    ctrlTab();
    await vi.waitFor(() => expect(activeTab()).toBe("t4"));
    ctrlTab();
    await vi.waitFor(() => expect(activeTab()).toBe("t3"));
  });
});
