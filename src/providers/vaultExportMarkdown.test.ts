import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { Uri } from "../test/__mocks__/vscode";
import { MAX_DETAIL_LIMIT } from "../vault/readers/detail";
import type { VaultSessionDetail, VaultSessionEntry } from "../vault/types";
import { COPY_EXPORT, exportVaultSessionMarkdown, OPEN_EXPORT, type VaultExportDeps } from "./vaultExportMarkdown";

const ENTRY: VaultSessionEntry = {
  id: "claude:s1",
  agent: "claude",
  sessionId: "s1",
  title: "Fix login",
  cwd: "/work/app",
  modified: 0,
  flags: {},
};

const DETAIL: VaultSessionDetail = {
  entryId: "claude:s1",
  contentKind: "timeline",
  recentActivity: [],
  timeline: [{ kind: "message", role: "user", text: "hello there" }],
  stats: { messageCount: 1, toolCount: 0, subagentCount: 0 },
};

const TARGET = Uri.file("/out/session.md") as unknown as vscode.Uri;

function deps(over: Partial<VaultExportDeps> = {}) {
  const fs = {
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  const d = {
    vaultService: {
      getEntry: vi.fn(async () => ENTRY),
      getDetail: vi.fn(async () => DETAIL),
      customNameOf: vi.fn((): string | undefined => undefined),
    },
    showSaveDialog: vi.fn(async (_opts: vscode.SaveDialogOptions) => TARGET as vscode.Uri | undefined),
    showInformationMessage: vi.fn(async (_m: string, ..._items: string[]) => undefined as string | undefined),
    showErrorMessage: vi.fn(async (_m: string) => undefined),
    writeClipboard: vi.fn(async (_t: string) => {}),
    openDocument: vi.fn(async (_u: vscode.Uri) => undefined),
    isDirectory: vi.fn(async (_u: vscode.Uri) => true),
    workspaceFolder: Uri.file("/ws") as unknown as vscode.Uri,
    fs,
  };
  return { ...d, ...over } as typeof d;
}

/** The UTF-8 text the export wrote to its temp file. */
function written(d: ReturnType<typeof deps>): string {
  const calls = d.fs.writeFile.mock.calls as unknown as [vscode.Uri, Uint8Array][];
  return Buffer.from(calls[0][1]).toString("utf8");
}

describe("exportVaultSessionMarkdown", () => {
  it("reads the whole timeline, asks where to save, and writes the Markdown", async () => {
    const d = deps();
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.vaultService.getDetail).toHaveBeenCalledWith("claude:s1", MAX_DETAIL_LIMIT);
    const opts = d.showSaveDialog.mock.calls[0][0];
    expect(opts.filters).toEqual({ Markdown: ["md"] });
    expect(opts.defaultUri?.fsPath).toMatch(/^\/work\/app\/fix-login-\d{4}-\d{2}-\d{2}\.md$/);
    expect(written(d)).toContain("# Fix login");
    expect(written(d)).toContain("hello there");
    expect(d.fs.rename).toHaveBeenCalledWith(expect.anything(), TARGET, { overwrite: true });
    expect(d.showInformationMessage).toHaveBeenCalledWith(
      "Portaterm: exported the session to /out/session.md.",
      OPEN_EXPORT,
      COPY_EXPORT,
    );
    expect(d.openDocument).not.toHaveBeenCalled();
    expect(d.writeClipboard).not.toHaveBeenCalled();
  });

  it("titles the file with the user's custom name", async () => {
    const d = deps();
    d.vaultService.customNameOf.mockReturnValue("My rename");
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(written(d)).toMatch(/^# My rename\n/);
    expect(d.showSaveDialog.mock.calls[0][0].defaultUri?.fsPath).toMatch(/\/my-rename-/);
  });

  it("starts in the workspace folder when the session's folder is gone", async () => {
    const d = deps({ isDirectory: vi.fn(async () => false) });
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.showSaveDialog.mock.calls[0][0].defaultUri?.fsPath).toMatch(/^\/ws\/fix-login-/);
  });

  it("falls back to a bare filename with neither folder available", async () => {
    const d = deps({ isDirectory: vi.fn(async () => false), workspaceFolder: undefined });
    d.vaultService.getEntry.mockResolvedValue({ ...ENTRY, cwd: "" });
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.isDirectory).not.toHaveBeenCalled();
    expect(d.showSaveDialog.mock.calls[0][0].defaultUri?.fsPath).toMatch(/^fix-login-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("opens the file when asked", async () => {
    const d = deps();
    d.showInformationMessage.mockResolvedValue(OPEN_EXPORT);
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.openDocument).toHaveBeenCalledWith(TARGET);
  });

  it("copies the same Markdown to the clipboard when asked", async () => {
    const d = deps();
    d.showInformationMessage.mockResolvedValue(COPY_EXPORT);
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.writeClipboard).toHaveBeenCalledWith(written(d));
  });

  it("writes nothing when the dialog is cancelled", async () => {
    const d = deps({ showSaveDialog: vi.fn(async () => undefined) });
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.fs.writeFile).not.toHaveBeenCalled();
    expect(d.showInformationMessage).not.toHaveBeenCalled();
    expect(d.showErrorMessage).not.toHaveBeenCalled();
  });

  it("reports a session that no longer exists, without opening the dialog", async () => {
    const d = deps();
    d.vaultService.getEntry.mockResolvedValue(null as unknown as VaultSessionEntry);
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("no longer exists"));
    expect(d.showSaveDialog).not.toHaveBeenCalled();
  });

  it("reports a transcript that cannot be read", async () => {
    const d = deps();
    d.vaultService.getDetail.mockResolvedValue(null as unknown as VaultSessionDetail);
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("could not read that session's transcript"),
    );
    expect(d.showSaveDialog).not.toHaveBeenCalled();
  });

  it("reports a read that throws", async () => {
    const d = deps();
    d.vaultService.getDetail.mockRejectedValue(new Error("EACCES"));
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.showErrorMessage).toHaveBeenCalledWith("Portaterm: could not read that session — EACCES.");
    expect(d.showSaveDialog).not.toHaveBeenCalled();
  });

  it("reports a failed write and offers nothing to open", async () => {
    const d = deps();
    d.fs.rename.mockRejectedValue("disk full");
    await exportVaultSessionMarkdown("claude:s1", d);
    expect(d.showErrorMessage).toHaveBeenCalledWith("Portaterm: failed to write /out/session.md — disk full.");
    expect(d.showInformationMessage).not.toHaveBeenCalled();
  });
});
