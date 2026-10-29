// src/providers/vaultExportMarkdown.ts — "Export as Markdown" for a vault session.
//
// The webview names the session by id and nothing else: the host re-reads the
// entry and its full timeline itself, renders the Markdown, asks where to save
// it, and writes it. No transcript text crosses the IPC boundary inbound.

import * as vscode from "vscode";
import { type FsLike, writeExportAtomically } from "../commands/exportHelpers";
import { renderSessionMarkdown, sessionExportFilename } from "../vault/exportMarkdown";
import { MAX_DETAIL_LIMIT } from "../vault/readers/detail";
import type { VaultService } from "../vault/VaultService";

export const OPEN_EXPORT = "Open";
export const COPY_EXPORT = "Copy to Clipboard";

/** The VS Code surface the export uses — narrow so tests can drive every branch. */
export interface VaultExportDeps {
  vaultService: Pick<VaultService, "getEntry" | "getDetail" | "customNameOf">;
  showSaveDialog(opts: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined>;
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showErrorMessage(message: string): Thenable<string | undefined>;
  writeClipboard(text: string): Thenable<void>;
  openDocument(uri: vscode.Uri): Thenable<unknown>;
  /** Whether a folder exists, to start the save dialog in the session's own folder. */
  isDirectory(uri: vscode.Uri): Thenable<boolean>;
  workspaceFolder?: vscode.Uri;
  fs: FsLike;
}

/** Wires {@link VaultExportDeps} to the real VS Code API. */
export function vscodeVaultExportDeps(vaultService: VaultService): VaultExportDeps {
  return {
    vaultService,
    showSaveDialog: (opts) => vscode.window.showSaveDialog(opts),
    showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    showErrorMessage: (message) => vscode.window.showErrorMessage(message),
    writeClipboard: (text) => vscode.env.clipboard.writeText(text),
    openDocument: (uri) => vscode.window.showTextDocument(uri),
    isDirectory: (uri) =>
      vscode.workspace.fs.stat(uri).then(
        (s) => (s.type & vscode.FileType.Directory) !== 0,
        () => false,
      ),
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
    fs: vscode.workspace.fs,
  };
}

/**
 * Export one vault session's timeline to a Markdown file the user picks.
 * Every failure surfaces as an error toast; cancelling the dialog does nothing.
 */
export async function exportVaultSessionMarkdown(entryId: string, deps: VaultExportDeps): Promise<void> {
  let markdown: string;
  let filename: string;
  let cwd: string;
  try {
    const found = await deps.vaultService.getEntry(entryId);
    if (!found) {
      await deps.showErrorMessage("Portaterm: that session no longer exists, so it cannot be exported.");
      return;
    }
    // The name the list shows: a rename lives in the sidecar overlay, not the entry.
    const customName = deps.vaultService.customNameOf(entryId);
    const entry = customName ? { ...found, customName } : found;
    // The whole session, not the page the preview happens to have loaded.
    const detail = await deps.vaultService.getDetail(entryId, MAX_DETAIL_LIMIT);
    if (!detail) {
      await deps.showErrorMessage("Portaterm: could not read that session's transcript.");
      return;
    }
    markdown = renderSessionMarkdown(entry, detail);
    filename = sessionExportFilename(entry);
    cwd = entry.cwd;
  } catch (err) {
    await deps.showErrorMessage(`Portaterm: could not read that session — ${errorText(err)}.`);
    return;
  }

  const folder = await saveFolder(cwd, deps);
  const target = await deps.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, filename) : vscode.Uri.file(filename),
    filters: { Markdown: ["md"] },
    saveLabel: "Export",
    title: "Export Session as Markdown",
  });
  if (!target) {
    return;
  }

  try {
    await writeExportAtomically(target, markdown, deps.fs);
  } catch (err) {
    await deps.showErrorMessage(`Portaterm: failed to write ${target.fsPath} — ${errorText(err)}.`);
    return;
  }

  const choice = await deps.showInformationMessage(
    `Portaterm: exported the session to ${target.fsPath}.`,
    OPEN_EXPORT,
    COPY_EXPORT,
  );
  if (choice === OPEN_EXPORT) {
    await deps.openDocument(target);
  } else if (choice === COPY_EXPORT) {
    await deps.writeClipboard(markdown);
  }
}

/** The session's own folder when it still exists, else the workspace's. */
async function saveFolder(cwd: string, deps: VaultExportDeps): Promise<vscode.Uri | undefined> {
  if (cwd) {
    const uri = vscode.Uri.file(cwd);
    if (await deps.isDirectory(uri)) {
      return uri;
    }
  }
  return deps.workspaceFolder;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
