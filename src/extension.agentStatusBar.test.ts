// @vitest-environment jsdom
// src/extension.agentStatusBar.test.ts — the status bar entry as `activate` wires it.
//
// `agentStatusBar.test.ts` owns what the entry says and what a click decides;
// this owns that the shipped `activate` puts that in front of the user: the
// entry is there from the start, a click on it reaches a registered command,
// and that command lands on a real Portaterm view.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GO_TO_AGENT_COMMAND, OPEN_COMMAND } from "./session/agentStatusBar";

// Every test re-imports and re-activates the whole extension; under full-suite
// load that is slower than Vitest's 5s default.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await import("./extension");
}, 120_000);

// Real directories: `deactivate` flushes snapshots into workspace storage, and a
// path nothing can create turns every teardown into a logged ENOENT.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-status-")));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

interface StatusItem {
  id: string | undefined;
  name: string | undefined;
  text: string;
  tooltip: unknown;
  command: unknown;
  visible: boolean;
}

let subscriptions: Array<{ dispose(): unknown }> = [];
let teardown: (() => Promise<void> | void) | undefined;

afterEach(async () => {
  await teardown?.();
  teardown = undefined;
  for (const subscription of subscriptions.splice(0)) {
    subscription.dispose();
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
});

async function activateExtension() {
  const { activate, deactivate } = await import("./extension");
  teardown = deactivate;
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };

  const items: StatusItem[] = [];
  vi.spyOn(vscode.window, "createStatusBarItem").mockImplementation((id?: string) => {
    const item: StatusItem & { show(): void; hide(): void; dispose(): void; backgroundColor: unknown } = {
      id,
      name: undefined,
      text: "",
      tooltip: undefined,
      command: undefined,
      backgroundColor: undefined,
      visible: false,
      show: () => {
        item.visible = true;
      },
      hide: () => {
        item.visible = false;
      },
      dispose: () => {},
    };
    items.push(item);
    return item;
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation((command, callback) => {
    handlers.set(command, callback);
    return { dispose: () => handlers.delete(command) };
  });
  const executed: string[] = [];
  vi.spyOn(vscode.commands, "executeCommand").mockImplementation(async (command: string, ...args: unknown[]) => {
    executed.push(command);
    // Commands this extension registered run for real, as the editor would run them.
    await handlers.get(command)?.(...args);
  });
  const quickPick = vi.spyOn(vscode.window, "showQuickPick");

  subscriptions = [];
  await activate({
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions,
    globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: path.join(TMP, "storage") },
    storageUri: { fsPath: path.join(TMP, "workspace-storage") },
    extensionPath: "/mock/extension",
    logUri: { fsPath: path.join(TMP, "log") },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {} },
  } as never);

  const entry = items.find((item) => item.id === "portaterm.agentStatus");
  if (entry === undefined) {
    throw new Error("activate did not create the agent status entry");
  }
  const run = async (command: string) => {
    const handler = handlers.get(command);
    if (handler === undefined) {
      throw new Error(`${command} is not registered`);
    }
    executed.length = 0;
    await handler();
  };
  return { entry, executed, run, quickPick };
}

describe("the agent status entry as activate wires it", () => {
  // The entry exists only once `activate` runs. A workspace that never opened a
  // Portaterm view or ran one of its commands would otherwise never activate it.
  it("activates on startup, so the entry is there before any view has opened", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
      activationEvents: string[];
    };
    expect(manifest.activationEvents).toContain("onStartupFinished");
  });

  it("is shown from the start as the bare name, and a click on it opens Portaterm", async () => {
    const h = await activateExtension();
    expect(h.entry).toMatchObject({ name: "Portaterm", text: "Portaterm", command: OPEN_COMMAND, visible: true });
  });

  it("opens the sidebar view until the user has worked in either one", async () => {
    const h = await activateExtension();
    await h.run(OPEN_COMMAND);
    expect(h.executed).toEqual(["portaterm.sidebar.focus"]);
  });

  it("opens Portaterm without a pick when Go to Agent finds no agent", async () => {
    const h = await activateExtension();
    await h.run(GO_TO_AGENT_COMMAND);
    expect(h.quickPick).not.toHaveBeenCalled();
    expect(h.executed).toEqual([OPEN_COMMAND, "portaterm.sidebar.focus"]);
  });
});
