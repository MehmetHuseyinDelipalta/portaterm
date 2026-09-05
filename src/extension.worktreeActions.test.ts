// src/extension.worktreeActions.test.ts — the wiring behind the host's action
// seam, and one decision in particular: WHICH surface a focus reveals.
//
// The host owns resolution (WorktreeHost.actions.test.ts). What is under test
// here is what happens after: a pane must be revealed in the view that HOLDS
// it, because with the panel open in two places, revealing the one that asked
// focuses a pane the user cannot see.
//
// See: asimov/changes/wire-worktree-navigation-actions/design.md D2, D4.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorktreeActions, pickCopyFilePath, type WorktreeActionDeps } from "./extension";
import { __resetAll, __setShowOpenDialog } from "./test/__mocks__/vscode";
import type { ExtensionToWebViewMessage } from "./types/messages";

const SIDEBAR = "anywhereTerminal.sidebar";
const PANEL = "anywhereTerminal.panel";
const EDITOR = "editor-abc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolve_) => {
    resolve = resolve_;
  });
  return { promise, resolve };
}

afterEach(() => __resetAll());

function harness(over: Partial<WorktreeActionDeps> = {}) {
  const commands: Array<[string, ...unknown[]]> = [];
  const clipboard: string[] = [];
  const folders: Array<[number, unknown]> = [];
  const editorPosts: ExtensionToWebViewMessage[] = [];
  const viewPosts: Array<[string, ExtensionToWebViewMessage]> = [];
  const revealed: string[] = [];

  const deps: WorktreeActionDeps = {
    executeCommand: async (command, ...args) => {
      commands.push([command, ...args]);
      return undefined;
    },
    writeClipboard: async (text) => {
      clipboard.push(text);
    },
    pickFolder: async () => undefined,
    promptSetupStep: async () => undefined,
    // Identity, so an assertion reads the path rather than a Uri stand-in.
    fileUri: (path) => path,
    workspaceFolderCount: () => 2,
    addWorkspaceFolder: (at, uri) => folders.push([at, uri]),
    editorForView: (viewId) =>
      viewId === EDITOR
        ? {
            reveal: () => revealed.push(viewId),
            post: (msg) => editorPosts.push(msg),
          }
        : undefined,
    postToView: (viewId, msg) => viewPosts.push([viewId, msg]),
    resumeCommand: async () => "claude --resume s1",
    sessionCwd: async () => "/repo-wt/feat",
    ...over,
  };

  return { actions: createWorktreeActions(deps), deps, commands, clipboard, folders, editorPosts, viewPosts, revealed };
}

describe("a focused pane is revealed where it actually lives", () => {
  it("reveals the editor panel holding the pane, then activates it there", async () => {
    const h = harness();
    await h.actions.focusPane("pane-1", EDITOR);

    expect(h.revealed).toEqual([EDITOR]);
    expect(h.editorPosts).toEqual([{ type: "worktreeActivatePane", paneId: "pane-1" }]);
    // No view focus command: an editor panel is not revealed by one.
    expect(h.commands).toEqual([]);
    expect(h.viewPosts).toEqual([]);
  });

  it("focuses the bottom panel for a pane that lives there", async () => {
    const h = harness();
    await h.actions.focusPane("pane-1", PANEL);

    expect(h.commands).toEqual([["anywhereTerminal.panel.focus"]]);
    expect(h.viewPosts).toEqual([[PANEL, { type: "worktreeActivatePane", paneId: "pane-1" }]]);
  });

  it("focuses the sidebar for a pane that lives there", async () => {
    const h = harness();
    await h.actions.focusPane("pane-1", SIDEBAR);

    expect(h.commands).toEqual([["anywhereTerminal.sidebar.focus"]]);
    expect(h.viewPosts).toEqual([[SIDEBAR, { type: "worktreeActivatePane", paneId: "pane-1" }]]);
  });

  it("does nothing for an editor view whose panel is gone", async () => {
    // Falling back to the sidebar would reveal a surface that does not hold the
    // pane — the exact substitution D4 exists to prevent.
    const h = harness();
    await h.actions.focusPane("pane-1", "editor-closed");

    expect(h.revealed).toEqual([]);
    expect(h.commands).toEqual([]);
    expect(h.viewPosts).toEqual([]);
  });
});

describe("the worktree capabilities", () => {
  it("opens a folder in a new window", async () => {
    const h = harness();
    await h.actions.openFolder("/repo-wt/feat", "newWindow");

    expect(h.commands).toEqual([["vscode.openFolder", "/repo-wt/feat", { forceNewWindow: true }]]);
    expect(h.folders).toEqual([]);
  });

  it("appends a workspace folder rather than replacing what the user had open", async () => {
    const h = harness();
    await h.actions.openFolder("/repo-wt/feat", "addToWorkspace");

    expect(h.folders).toEqual([[2, "/repo-wt/feat"]]);
    expect(h.commands).toEqual([]);
  });

  it("reveals a path in the OS file manager", async () => {
    const h = harness();
    await h.actions.revealInOS("/repo-wt/feat");
    expect(h.commands).toEqual([["revealFileInOS", "/repo-wt/feat"]]);
  });

  it("copies whatever text it is handed", async () => {
    const h = harness();
    await h.actions.copyText("/repo-wt/feat");
    expect(h.clipboard).toEqual(["/repo-wt/feat"]);
  });
});

describe("the session capabilities", () => {
  it("copies the command the launcher itself would run", async () => {
    const h = harness();
    await h.actions.copyResumeCommand("claude:s1");
    expect(h.clipboard).toEqual(["claude --resume s1"]);
  });

  it("reveals and copies the working directory the vault recorded", async () => {
    const h = harness();
    await h.actions.revealSessionCwd("claude:s1");
    await h.actions.copySessionCwd("claude:s1");

    expect(h.commands).toEqual([["revealFileInOS", "/repo-wt/feat"]]);
    expect(h.clipboard).toEqual(["/repo-wt/feat"]);
  });

  it("does nothing for a session with no recorded working directory", async () => {
    // Never the workspace root in its place: a reveal of the wrong directory is
    // worse than no reveal at all.
    const h = harness({ sessionCwd: async () => undefined });
    await h.actions.revealSessionCwd("claude:s1");
    await h.actions.copySessionCwd("claude:s1");

    expect(h.commands).toEqual([]);
    expect(h.clipboard).toEqual([]);
  });

  it("copies nothing when the resume command cannot be built", async () => {
    const h = harness({
      resumeCommand: async () => {
        throw new Error("unknown-agent");
      },
    });
    await expect(h.actions.copyResumeCommand("claude:s1")).rejects.toThrow("unknown-agent");
    expect(h.clipboard).toEqual([]);
  });
});

describe("a file picked for this create", () => {
  const picked = async (
    over: {
      selected?: string | null;
      root?: string;
      candidates?: readonly (string | null)[];
      hold?: () => Promise<ReturnType<typeof held> | undefined>;
      reserve?: boolean;
      elapsed?: Promise<void>;
    } = {},
  ) => {
    const file = held();
    const abandon = vi.fn();
    const hold = vi.fn(over.hold ?? (async () => file));
    const reserve = vi.fn(() => (over.reserve === false ? undefined : { hold, abandon }));
    const pool = { charged: 0, reserve, dispose: vi.fn() };
    const answers = [...(over.candidates ?? ["/private/repo/.env", "/private/repo/.env"])] as Array<string | null>;
    const actions = createWorktreeActions({
      ...harnessDeps(),
      pickFile: async () => (over.selected === null ? undefined : (over.selected ?? "/repo/.env")),
      heldRegularFiles: pool,
      resolvedPathDeps: {
        realpath: async (value) => {
          if (value === "/repo") {
            return over.root ?? "/private/repo";
          }
          const answer = answers.shift();
          if (answer === null || answer === undefined) {
            throw Object.assign(new Error("unresolved"), { code: "EACCES" });
          }
          return answer;
        },
      },
      pickCopyDeadline: () => ({
        elapsed: over.elapsed ?? new Promise<void>(() => {}),
        expired: false,
        cancel: vi.fn(),
      }),
    } as WorktreeActionDeps);
    return { actions, file, abandon, hold, reserve };
  };

  function held() {
    return { claim: vi.fn(), dispose: vi.fn() };
  }

  function harnessDeps(): WorktreeActionDeps {
    return harness().deps;
  }

  it("opens one file at the repository and returns a cancelled answer unchanged", async () => {
    const options: unknown[] = [];
    __setShowOpenDialog(async (given) => {
      options.push(given);
      return undefined;
    });

    expect(await pickCopyFilePath("/repo")).toBeUndefined();
    expect(options).toEqual([
      {
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        defaultUri: expect.objectContaining({ fsPath: "/repo" }),
        openLabel: "Add File",
        title: "Add a file to copy for this create",
      },
    ]);
  });

  it("does not reserve a lifecycle slot when the picker is dismissed", async () => {
    const h = await picked({ selected: null });
    const pick = h.actions.pickCopyFile;
    if (pick === undefined) {
      throw new Error("picker action missing");
    }

    await expect(pick("/repo")).resolves.toBeUndefined();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("returns the held object and canonical POSIX path after matching alias answers", async () => {
    const h = await picked();
    const pick = h.actions.pickCopyFile;
    if (pick === undefined) {
      throw new Error("picker action missing");
    }

    await expect(pick("/repo")).resolves.toEqual({
      path: ".env",
      canonicalPath: "/private/repo/.env",
      file: h.file,
    });
    expect(h.hold).toHaveBeenCalledWith("/repo/.env");
    expect(h.file.dispose).not.toHaveBeenCalled();
  });

  it.each([
    ["root equality", ["/private/repo"]],
    ["an outside path", ["/other/.env"]],
  ])("refuses %s before holding it", async (_name, candidates) => {
    const h = await picked({ candidates });
    const pick = h.actions.pickCopyFile;
    if (pick === undefined) {
      throw new Error("picker action missing");
    }

    await expect(pick("/repo")).resolves.toBeUndefined();
    expect(h.hold).not.toHaveBeenCalled();
    expect(h.abandon).toHaveBeenCalledOnce();
  });

  it("refuses pool exhaustion and an unsupported no-follow hold", async () => {
    const exhausted = await picked({ reserve: false });
    const noSlot = exhausted.actions.pickCopyFile;
    if (noSlot === undefined) {
      throw new Error("picker action missing");
    }
    await expect(noSlot("/repo")).resolves.toBeUndefined();

    const unsupported = await picked({ hold: async () => undefined });
    const noFile = unsupported.actions.pickCopyFile;
    if (noFile === undefined) {
      throw new Error("picker action missing");
    }
    await expect(noFile("/repo")).resolves.toBeUndefined();
    expect(unsupported.abandon).toHaveBeenCalledOnce();
  });

  it("disposes a held file when the second containment answer drifts", async () => {
    const h = await picked({ candidates: ["/private/repo/.env", "/private/repo/other.env"] });
    const pick = h.actions.pickCopyFile;
    if (pick === undefined) {
      throw new Error("picker action missing");
    }

    await expect(pick("/repo")).resolves.toBeUndefined();
    expect(h.file.dispose).toHaveBeenCalledOnce();
  });

  it("abandons a stalled hold and disposes its late answer", async () => {
    const holding = deferred<ReturnType<typeof held>>();
    const elapsed = deferred<void>();
    const h = await picked({ hold: () => holding.promise, elapsed: elapsed.promise });
    const pick = h.actions.pickCopyFile;
    if (pick === undefined) {
      throw new Error("picker action missing");
    }
    const answer = pick("/repo");
    await new Promise((resolve) => setImmediate(resolve));

    elapsed.resolve();
    await expect(answer).resolves.toBeUndefined();
    expect(h.abandon).toHaveBeenCalledOnce();
    holding.resolve(h.file);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.file.dispose).toHaveBeenCalledOnce();
  });
});
