import type * as vscode from "vscode";

export interface MockExtensionContextOptions {
  fsPath?: string;
  /** Pass `undefined` explicitly to omit workspaceState from the mock. */
  workspaceState?: vscode.ExtensionContext["workspaceState"];
}

export function mockExtensionContext(options: MockExtensionContextOptions = {}): vscode.ExtensionContext {
  const context: {
    extensionUri: { fsPath: string };
    subscriptions: never[];
    workspaceState?: vscode.ExtensionContext["workspaceState"];
  } = {
    extensionUri: { fsPath: options.fsPath ?? "/mock/ext" },
    subscriptions: [],
  };

  if (!("workspaceState" in options)) {
    context.workspaceState = {
      get: () => undefined,
      update: () => Promise.resolve(),
    } as unknown as vscode.ExtensionContext["workspaceState"];
  } else if (options.workspaceState !== undefined) {
    context.workspaceState = options.workspaceState;
  }

  return context as unknown as vscode.ExtensionContext;
}

export async function pumpImmediateMacrotasks(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export async function pumpTimeoutMacrotasks(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
