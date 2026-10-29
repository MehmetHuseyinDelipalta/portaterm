// @vitest-environment jsdom
// src/webview/main.paneZoom.test.ts — pane zoom through the shipped webview.
//
// The pieces have their own tests; this boots the real `main.ts` inside the real
// webview HTML and drives it the way the host and the user do, so the wiring
// between them — the router entry, the focus-then-zoom order, the renderer's
// zoom source, the tab-bar mark, the pruning on split, close and focus, and the
// stylesheet rules that do the hiding — cannot break silently.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { getTerminalHtml } from "../providers/webviewHtml";

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

const zoomMark = () => tab().querySelector<HTMLElement>(".tab-zoom-mark")!;
const display = (el: HTMLElement) => window.getComputedStyle(el).display;
const committedPane = () =>
  posted.filter((m) => m.type === "terminalNavigationCommitted").at(-1)?.activePaneId as string | undefined;

function expectZoomedTo(paneId: string, hidden: string[]): void {
  expect(tabContainer().classList.contains("pane-zoomed")).toBe(true);
  expect(leaf(paneId).classList.contains("zoomed-pane")).toBe(true);
  expect(zoomMark().hidden).toBe(false);
  expect(tab().getAttribute("aria-label")).toContain("pane zoomed, other panes hidden");
  // The shipped stylesheet does the hiding.
  expect(display(leaf(paneId))).not.toBe("none");
  for (const id of hidden) {
    expect(display(leaf(id))).toBe("none");
  }
  for (const handle of Array.from(tabContainer().querySelectorAll<HTMLElement>(".split-handle"))) {
    expect(display(handle)).toBe("none");
  }
  expect(JSON.parse(leaf(paneId).dataset.vscodeContext!)).toMatchObject({ paneSplit: true, paneZoomed: true });
  expect(JSON.parse(paneHandle(paneId).container.dataset.vscodeContext!).paneZoomed).toBe(true);
}

function expectFullLayout(panes: string[]): void {
  expect(tabContainer().classList.contains("pane-zoomed")).toBe(false);
  expect(tabContainer().querySelectorAll(".zoomed-pane, .zoom-path")).toHaveLength(0);
  expect(zoomMark().hidden).toBe(true);
  for (const id of panes) {
    expect(display(leaf(id))).not.toBe("none");
    expect(JSON.parse(leaf(id).dataset.vscodeContext!).paneZoomed).toBe(false);
  }
}

describe("pane zoom in the shipped webview", () => {
  it("shows the full layout until the host zooms a pane", async () => {
    await bootWithSplit();
    expectFullLayout(["t1", "p2"]);
    expect(JSON.parse(leaf("p2").dataset.vscodeContext!)).toMatchObject({ paneSplit: true, paneZoomed: false });
  });

  it("zooms the named pane and hides the rest", async () => {
    await bootWithSplit();
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: true });
    expectZoomedTo("p2", ["t1"]);
  });

  it("makes a right-clicked pane that was not active the active one, then zooms it", async () => {
    await bootWithSplit();
    // The split left the new pane active.
    expect(leaf("p2").classList.contains("active-pane")).toBe(true);
    host({ type: "setPaneZoom", sessionId: "t1", zoomed: true });
    expectZoomedTo("t1", ["p2"]);
    expect(leaf("t1").classList.contains("active-pane")).toBe(true);
    expect(committedPane()).toBe("t1");
  });

  it("zooms a pane nested two branches deep and keeps its branches on screen", async () => {
    await bootWithSplit();
    await split("p3", 3);
    posted = [];
    host({ type: "setPaneZoom", sessionId: "p3", zoomed: true });
    expectZoomedTo("p3", ["t1", "p2"]);
    const branches = Array.from(tabContainer().querySelectorAll<HTMLElement>(".split-branch"));
    expect(branches.filter((b) => b.contains(leaf("p3"))).every((b) => display(b) !== "none")).toBe(true);
  });

  it("hides a sibling branch whole — left in the layout, its flex share would halve the zoomed pane", async () => {
    await bootWithSplit();
    await split("p3", 3);
    host({ type: "setPaneZoom", sessionId: "t1", zoomed: true });
    expectZoomedTo("t1", ["p2", "p3"]);
    const sibling = leaf("p2").parentElement!;
    expect(sibling.classList.contains("split-branch")).toBe(true);
    expect(sibling.contains(leaf("t1"))).toBe(false);
    expect(display(sibling)).toBe("none");
    // The zoomed leaf and its branch are made to fill whatever their inline ratio says.
    expect(window.getComputedStyle(leaf("t1")).flexGrow).toBe("1");
    expect(window.getComputedStyle(leaf("t1").parentElement!).flexGrow).toBe("1");
  });

  it("toggles back to the full layout without moving focus", async () => {
    await bootWithSplit();
    host({ type: "setPaneZoom", sessionId: "p2" });
    expectZoomedTo("p2", ["t1"]);
    posted = [];
    host({ type: "setPaneZoom", sessionId: "p2" });
    expectFullLayout(["t1", "p2"]);
    expect(leaf("p2").classList.contains("active-pane")).toBe(true);
    expect(committedPane()).toBeUndefined();
  });

  it("unzooms from the context menu of the zoomed pane", async () => {
    await bootWithSplit();
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: true });
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: false });
    expectFullLayout(["t1", "p2"]);
  });

  it("ends when focus moves to a hidden pane, which is then on screen", async () => {
    await bootWithSplit();
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: true });
    leaf("t1").dispatchEvent(new MouseEvent("mousedown"));
    await vi.waitFor(() => expect(leaf("t1").classList.contains("active-pane")).toBe(true));
    expectFullLayout(["t1", "p2"]);

    // Ended for good: focusing the old pane again does not bring it back.
    leaf("p2").dispatchEvent(new MouseEvent("mousedown"));
    await vi.waitFor(() => expect(leaf("p2").classList.contains("active-pane")).toBe(true));
    expectFullLayout(["t1", "p2"]);
  });

  it("ends when the zoomed pane is split, showing the new pane", async () => {
    await bootWithSplit();
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: true });
    await split("p3", 3);
    expectFullLayout(["t1", "p2", "p3"]);
  });

  it("ends when a hidden pane closes", async () => {
    await bootWithSplit();
    await split("p3", 3);
    host({ type: "setPaneZoom", sessionId: "p3", zoomed: true });
    host({ type: "closeSplitPaneById", sessionId: "p2" });
    await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(2));
    expectFullLayout(["t1", "p3"]);
  });

  it("ends when the zoomed pane closes, and a later split starts unzoomed", async () => {
    await bootWithSplit();
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: true });
    host({ type: "closeSplitPaneById", sessionId: "p2" });
    await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(1));
    expect(tabContainer().classList.contains("pane-zoomed")).toBe(false);
    expect(zoomMark().hidden).toBe(true);

    await split("p3", 2);
    expectFullLayout(["t1", "p3"]);
  });

  it("explains instead of zooming a single-pane tab", async () => {
    await bootWithSplit();
    host({ type: "closeSplitPaneById", sessionId: "p2" });
    await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(1));
    host({ type: "setPaneZoom", sessionId: "t1" });
    expect(document.querySelector(".error-banner-message")?.textContent).toBe(
      "Zoom needs at least two panes — split this terminal first.",
    );
    expect(tabContainer().classList.contains("pane-zoomed")).toBe(false);
    expect(zoomMark().hidden).toBe(true);
  });

  it("keeps the broadcast frame on the zoomed pane — the hidden panes still hear the keys", async () => {
    await bootWithSplit();
    host({ type: "setBroadcastInput", sessionId: "t1", enabled: true });
    host({ type: "setPaneZoom", sessionId: "p2", zoomed: true });
    expectZoomedTo("p2", ["t1"]);
    expect(tabContainer().classList.contains("broadcast-input")).toBe(true);
    expect(tab().querySelector<HTMLElement>(".tab-broadcast-mark")!.hidden).toBe(false);
  });
});
