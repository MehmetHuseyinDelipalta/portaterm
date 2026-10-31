// @vitest-environment jsdom
// src/webview/main.broadcastInput.test.ts — broadcast input through the shipped webview.
//
// The pieces have their own tests; this boots the real `main.ts` inside the real
// webview HTML and drives it the way the host and the user do, so the wiring
// between them — the factory's typed-input seam, the keyboard shortcuts, the
// router entry, the tab-bar mark, the pruning on close — cannot break silently.

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
  const all: Array<{ container?: Element; data?: (d: string) => void; userInput?: () => void }> = [];

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
    private readonly handle: { container?: Element; data?: (d: string) => void; userInput?: () => void } = {};
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
    dispose() {}
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

const inputs = () => posted.filter((m) => m.type === "input").map((m) => ({ to: m.tabId, data: m.data }));

/** The fake terminal mounted for `sessionId`, found through its container's context. */
function paneHandle(sessionId: string) {
  for (const handle of xterm.all) {
    const context = (handle.container as HTMLElement | undefined)?.dataset.vscodeContext;
    if (context && JSON.parse(context).paneSessionId === sessionId) {
      return handle as { container: HTMLElement; data: (d: string) => void; userInput: () => void };
    }
  }
  throw new Error(`no terminal mounted for ${sessionId}`);
}

function type(sessionId: string, data: string): void {
  const pane = paneHandle(sessionId);
  pane.container.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  pane.userInput();
  pane.data(data);
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

const tab = () => document.querySelector<HTMLElement>('#tab-bar .tab-item[data-tab-id="t1"]')!;
const tabContainer = () => document.querySelector<HTMLElement>('#terminal-container [data-tab-id="t1"]')!;
const leaf = (id: string) => document.querySelector<HTMLElement>(`.split-leaf[data-session-id="${id}"]`)!;

function shortcut(init: KeyboardEventInit): void {
  paneHandle("t1")
    .container.querySelector("textarea")!
    .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("broadcast input in the shipped webview", () => {
  it("sends typed input to its own pane only until broadcasting starts", async () => {
    await bootWithSplit();
    type("p2", "ls\r");
    expect(inputs()).toEqual([{ to: "p2", data: "ls\r" }]);
    expect(tab().classList.contains("tab-broadcast")).toBe(false);
  });

  it("mirrors typed input to every pane once the host turns it on, and marks tab, frame and menu", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "p2", enabled: true });

    type("t1", "make\r");
    expect(inputs()).toEqual([
      { to: "t1", data: "make\r" },
      { to: "p2", data: "make\r" },
    ]);
    expect(tab().classList.contains("tab-broadcast")).toBe(true);
    expect(tab().querySelector<HTMLElement>(".tab-broadcast-mark")!.hidden).toBe(false);
    expect(tabContainer().classList.contains("broadcast-input")).toBe(true);
    expect(JSON.parse(leaf("p2").dataset.vscodeContext!)).toMatchObject({ paneSplit: true, broadcastInput: true });
  });

  it("keeps xterm's own replies and pointer input with the pane that produced them", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });
    const t1 = paneHandle("t1");

    t1.data("\x1b[12;1R"); // cursor-position report: no user-input flag
    t1.container.dispatchEvent(new MouseEvent("mousedown"));
    t1.userInput();
    t1.data("\x1b[<0;3;4M"); // mouse report: flagged, but from the pointer
    expect(inputs()).toEqual([
      { to: "t1", data: "\x1b[12;1R" },
      { to: "t1", data: "\x1b[<0;3;4M" },
    ]);
  });

  it("routes the document-level shortcuts through the broadcast", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });

    shortcut({ key: "Enter", shiftKey: true });
    shortcut({ key: "Backspace", ctrlKey: true });
    const active = posted.find((m) => m.type === "input")?.tabId as string;
    const other = active === "t1" ? "p2" : "t1";
    expect(inputs()).toEqual([
      { to: active, data: "\x1b\r" },
      { to: other, data: "\x1b\r" },
      { to: active, data: "\x15" },
      { to: other, data: "\x15" },
    ]);
  });

  it("routes the macOS line-editing shortcuts through the broadcast", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });

    shortcut({ key: "ArrowLeft", metaKey: true });
    shortcut({ key: "ArrowRight", metaKey: true });
    shortcut({ key: "Backspace", metaKey: true });
    shortcut({ key: "ArrowLeft", altKey: true });
    shortcut({ key: "ArrowRight", altKey: true });
    const sent = inputs();
    const byData = (data: string) => sent.filter((m) => m.data === data).map((m) => m.to);
    for (const data of ["\x01", "\x05", "\x15", "\x1bb", "\x1bf"]) {
      expect(byData(data).sort()).toEqual(["p2", "t1"]);
    }
    expect(sent).toHaveLength(10);
  });

  it("does not mirror a path dropped onto one pane", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });
    document.elementFromPoint = () => leaf("p2");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        types: ["application/x-portaterm-file-tree-path"],
        getData: () => "/repo/src/a.ts",
        files: [],
      },
    });
    document.getElementById("terminal-container")!.dispatchEvent(drop);
    // One pane only: the paths go to p2's host write, never through the broadcast.
    expect(inputs()).toEqual([]);
    expect(posted.filter((m) => m.type === "insertPaths")).toEqual([
      { type: "insertPaths", tabId: "p2", paths: ["/repo/src/a.ts"] },
    ]);
  });

  it("stops when the host turns it off", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });
    host({ type: "setBroadcastInput", sessionId: "p2", enabled: false });
    type("t1", "x");
    expect(inputs()).toEqual([{ to: "t1", data: "x" }]);
    expect(tab().classList.contains("tab-broadcast")).toBe(false);
    expect(tabContainer().classList.contains("broadcast-input")).toBe(false);
    expect(JSON.parse(leaf("t1").dataset.vscodeContext!).broadcastInput).toBe(false);
  });

  it("ends for good when the tab closes down to one pane", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });
    host({ type: "closeSplitPaneById", sessionId: "p2" });
    await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(1));

    expect(tab().classList.contains("tab-broadcast")).toBe(false);
    posted = [];
    type("t1", "y");
    expect(inputs()).toEqual([{ to: "t1", data: "y" }]);

    // Splitting again starts an unmirrored tab: the old switch does not come back.
    await split("p3", 2);
    posted = [];
    type("t1", "z");
    expect(inputs()).toEqual([{ to: "t1", data: "z" }]);
    expect(tab().classList.contains("tab-broadcast")).toBe(false);
  });

  it("explains instead of enabling on a single-pane tab", async () => {
    await bootWithSplit();
    host({ type: "closeSplitPaneById", sessionId: "p2" });
    await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(1));
    host({ type: "setBroadcastInput", sessionId: "t1" });
    expect(document.querySelector(".error-banner-message")?.textContent).toBe(
      "Broadcast input needs at least two panes — split this terminal first.",
    );
    expect(tab().classList.contains("tab-broadcast")).toBe(false);
  });
});
