// src/providers/webviewHtml.ts — Shared HTML generation for terminal webviews
// See: docs/design/webview-provider.md#§4

import * as crypto from "node:crypto";
import * as fs from "node:fs";
// Vendored VS Code list-widget CSS — see asimov/changes/port-vscode-async-data-tree/design.md D7.
// These are inlined into the webview's <style> block at HTML-generation time so that
// `.monaco-list`, `.monaco-scrollable-element`, etc. resolve in the webview without
// adding a separate <link> resource. esbuild's `loader: { '.css': 'text' }` returns
// the file contents as a string at bundle time.
import vendoredAriaCss from "vs/base/browser/ui/aria/aria.css";
import vendoredDndCss from "vs/base/browser/ui/dnd/dnd.css";
import vendoredListCss from "vs/base/browser/ui/list/list.css";
import vendoredScrollbarsCss from "vs/base/browser/ui/scrollbar/media/scrollbars.css";
import * as vscode from "vscode";
// Project-specific file-tree panel styles (rows + 4-side layout + theme variables).
import fileTreePanelCss from "../webview/fileTree/fileTreePanel.css";
// Shared hover-tooltip widget styles (.webview-tooltip) — file-tree + vault panels.
import tooltipCss from "../webview/ui/tooltip.css";
// AI-vault panel styles (flat list + badges + hidden state). See add-ai-coding-vault D10/D11.
import vaultPanelCss from "../webview/vault/vaultPanel.css";
// Worktree view styles. Loaded AFTER vaultPanel.css because the view is a fourth
// segment that swaps the vault panel's body and extends its shell classes.
import worktreePanelCss from "../webview/worktree/worktreePanel.css";

const VENDORED_LIST_CSS = [vendoredAriaCss, vendoredDndCss, vendoredListCss, vendoredScrollbarsCss].join("\n\n");
const FILE_TREE_CSS = fileTreePanelCss;
const TOOLTIP_CSS = tooltipCss;
const VAULT_CSS = vaultPanelCss;
const WORKTREE_CSS = worktreePanelCss;

/**
 * Generate secure HTML for a terminal webview with CSP and nonce.
 *
 * Used by both TerminalViewProvider (sidebar/panel) and TerminalEditorProvider (editor area)
 * to produce identical HTML structure. The only difference is the `data-terminal-location`
 * attribute on the body element.
 *
 * @param webview - The webview to generate HTML for
 * @param extensionUri - The extension's root URI (for resolving media/ resources)
 * @param location - The terminal location ('sidebar' | 'panel' | 'editor')
 * @returns The complete HTML string
 */
export function getTerminalHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  location: "sidebar" | "panel" | "editor",
): string {
  const nonce = crypto.randomBytes(16).toString("hex");

  // Convert file paths to webview-safe URIs. The script URI carries a
  // `?v=<mtime>-<size>` cache-buster keyed to the bundle: a webview caches the
  // resource by URL, so a plain "Reload Window" can keep serving a stale
  // `webview.js` after a rebuild — the failure mode that hid the new render code
  // live (DevTools showed 0 rendered nodes against a bundle that renders them).
  // mtimeMs alone misses rebuilds from a bundler that preserves the artifact
  // timestamp (R5), so the byte size is folded in: the version changes whenever
  // the file is re-emitted OR its length changes, and still caches when neither
  // does (nest-workflow-team-sessions D11).
  const scriptPath = vscode.Uri.joinPath(extensionUri, "media", "webview.js");
  let scriptVersion: string;
  try {
    const stat = fs.statSync(scriptPath.fsPath);
    scriptVersion = `${stat.mtimeMs}-${stat.size}`;
  } catch {
    scriptVersion = nonce; // bundle unreadable → always-fresh rather than risk staleness
  }
  // Append the version as a query in string space (not Uri.with) so it composes
  // regardless of whether asWebviewUri yields a query already.
  const baseScriptUri = String(webview.asWebviewUri(scriptPath));
  const scriptUri = `${baseScriptUri}${baseScriptUri.includes("?") ? "&" : "?"}v=${scriptVersion}`;
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "xterm.css"));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 img-src ${webview.cspSource} blob: data:;
                 font-src ${webview.cspSource} data:;">
  <link href="${styleUri}" rel="stylesheet">
  <style>
    /* === Vendored VS Code list-widget styles (see THIRD_PARTY_NOTICES.md) === */
    ${VENDORED_LIST_CSS}
    /* === End vendored styles === */

    /* === File-tree panel styles === */
    ${FILE_TREE_CSS}
    /* === End file-tree panel styles === */

    /* === Shared hover-tooltip widget === */
    ${TOOLTIP_CSS}
    /* === End shared hover-tooltip widget === */

    /* === AI-vault panel styles === */
    ${VAULT_CSS}
    /* === End AI-vault panel styles === */

    /* === Worktree view styles === */
    ${WORKTREE_CSS}
    /* === End Worktree view styles === */

    /* The UA's [hidden] rule is user-agent origin, so any author \`display\` above
       outranks it and a control the code hid stays on screen. Last and !important
       so every \`hidden\` writer in the webview means what it says. */
    [hidden] {
      display: none !important;
    }

    :root {
      --awt-tab-bar-height: 30px;
    }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    body {
      display: flex;
      flex-direction: column;
    }
    #tab-bar {
      container-type: inline-size;
      container-name: terminal-tabs;
      flex-shrink: 0;
      display: none;
      height: var(--awt-tab-bar-height);
      background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
      align-items: center;
      overflow-x: auto;
      overflow-y: hidden;
      user-select: none;
      font-size: 12px;
      font-family: var(--vscode-font-family, sans-serif);
      scrollbar-width: none;
    }
    #tab-bar::-webkit-scrollbar {
      display: none;
    }
    #tab-bar.visible {
      display: flex;
    }
    .tab-item {
      display: flex;
      align-items: center;
      height: 100%;
      padding: 0 8px;
      cursor: pointer;
      white-space: nowrap;
      color: var(--vscode-tab-inactiveForeground, #999);
      background: var(--vscode-tab-inactiveBackground, transparent);
      border-right: 1px solid var(--vscode-tab-border, transparent);
      gap: 6px;
      flex-shrink: 0;
    }
    .tab-item:hover {
      background: var(--vscode-tab-hoverBackground, rgba(255,255,255,0.05));
    }
    .tab-item.active {
      color: var(--vscode-tab-activeForeground, #fff);
      background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-focusBorder, #007acc);
    }
    .tab-item.tab-dragging {
      opacity: 0.5;
    }
    /* Drop position while a tab is dragged over another: an edge, not a border, so the tab does not change size. */
    .tab-item.tab-drop-before {
      box-shadow: inset 2px 0 0 var(--vscode-focusBorder, #007acc);
    }
    .tab-item.tab-drop-after {
      box-shadow: inset -2px 0 0 var(--vscode-focusBorder, #007acc);
    }
    .tab-status {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex: 0 0 7px;
      background: var(--vscode-descriptionForeground, #858585);
      opacity: 0.55;
    }
    .tab-status-running {
      background: var(--vscode-testing-iconPassed, #73c991);
      opacity: 1;
      animation: tab-status-pulse 1.2s ease-in-out infinite;
    }
    .tab-status-waiting {
      background: var(--vscode-editorWarning-foreground, #cca700);
      opacity: 1;
    }
    .tab-status-question {
      background: var(--vscode-charts-purple, #b180d7);
      opacity: 1;
    }
    .tab-status-unseen {
      background: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
      opacity: 1;
    }
    .tab-status-exited {
      background: var(--vscode-testing-iconFailed, #f14c4c);
      opacity: 0.8;
    }
    @keyframes tab-status-pulse {
      0%, 100% { transform: scale(0.82); opacity: 0.65; }
      50% { transform: scale(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tab-status-running { animation: none; }
    }
    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      opacity: 0;
      flex-shrink: 0;
    }
    .tab-item:hover .tab-close,
    .tab-item.active .tab-close {
      opacity: 0.7;
    }
    .tab-close:hover {
      opacity: 1 !important;
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
    }
    /* Pinned tab: always-visible pin mark in the close button's 16px slot. */
    .tab-pin {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      opacity: 0.7;
    }
    /* Broadcast input. Red, not the warning amber a waiting tab uses: this is a
       mode where a keystroke lands in several shells, the one state in which a
       slip costs more than one terminal. The mark sits before the name so it is
       read first, and stays on the tab while another tab is showing. */
    .tab-broadcast-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      margin-right: 4px;
      flex-shrink: 0;
      color: var(--vscode-charts-red, #f14c4c);
    }
    .tab-item.tab-broadcast {
      box-shadow: inset 0 -2px 0 var(--vscode-charts-red, #f14c4c);
    }
    /* Every pane that hears the keystroke wears the frame — drawn over the
       terminal (never in layout, so nothing resizes when it toggles) — and the
       inactive ones dim less, since they are receiving input too. */
    .broadcast-input .split-leaf::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      border: 1px solid var(--vscode-charts-red, #f14c4c);
      z-index: 9;
    }
    .broadcast-input .split-branch .split-leaf:not(.active-pane) {
      opacity: 0.85;
    }
    /* Pane zoom (paneZoom.ts). One leaf, and the branches that hold it, fill the
       tab; every other pane and every handle leaves the layout. !important beats
       the inline flex ratios SplitContainer writes: a lone child keeping
       "flex: 0.5" would fill only half the tab. */
    .pane-zoomed .split-handle,
    .pane-zoomed .split-leaf:not(.zoomed-pane),
    .pane-zoomed .split-branch:not(.zoom-path) {
      display: none !important;
    }
    .pane-zoomed .split-branch.zoom-path,
    .pane-zoomed .split-leaf.zoomed-pane {
      flex: 1 1 100% !important;
    }
    .tab-zoom-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      margin-right: 4px;
      flex-shrink: 0;
      opacity: 0.8;
    }
    /* Outline never participates in sizing, so switching owner cannot contract the terminal. */
    body:has(#tab-bar[data-worktree-scope]) .terminal-area {
      outline: 1px solid var(--vscode-focusBorder, #007acc);
      outline-offset: -1px;
    }
    /* The scope control owns the top-right corner. Filled, square, borderless:
       it reads as the terminal's context rather than as one more terminal tab. */
    .tab-scope {
      display: flex;
      align-items: center;
      height: 100%;
      padding: 0;
      margin-left: auto;
      flex-shrink: 0;
      white-space: nowrap;
      color: var(--vscode-button-foreground, #fff);
      background: var(--vscode-focusBorder, #007acc);
      position: sticky;
      right: 0;
      z-index: 1;
    }
    .tab-scope-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 100%;
      padding: 0 8px;
      box-sizing: border-box;
      color: inherit;
    }
    .tab-scope-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      color: inherit;
      flex: 0 0 auto;
    }
    .tab-scope-icon svg {
      width: 15px;
      height: 15px;
    }
    .tab-scope-kind {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.78;
    }
    .tab-scope-name {
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }
    .tab-scope[data-density="kind"] .tab-scope-name,
    .tab-scope[data-density="icon"] .tab-scope-name,
    .tab-scope[data-density="icon"] .tab-scope-kind {
      display: none;
    }
    .tab-scope[data-density="icon"] .tab-scope-chip {
      padding-inline: 7px;
    }
    /* The same attention vocabulary a waiting tab uses (--vscode-editorWarning-
       foreground), so one shape means one thing. Deliberately NOT the error
       colour: nothing has failed. Deliberately not animated either — the running
       pulse is for work in progress, and this is a standing count. */
    .tab-scope-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 13px;
      height: 13px;
      margin-left: 2px;
      padding: 0 3px;
      border-radius: 7px;
      font-size: 9px;
      font-weight: 600;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-editor-background, #1e1e1e);
      background: var(--vscode-editorWarning-foreground, #cca700);
    }
    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 100%;
      cursor: pointer;
      color: var(--vscode-tab-inactiveForeground, #999);
      background: transparent;
      border: none;
      font-size: 16px;
      padding: 0;
      flex-shrink: 0;
    }
    .tab-add:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
      color: var(--vscode-tab-activeForeground, #fff);
    }
    /* Tabs past the right edge. Pinned beside the scope chip (or the edge) and
       muted like an inactive tab: a count to glance at, not an alert — unless a
       hidden tab is waiting, which borrows the waiting tab's colour. */
    .tab-overflow {
      position: sticky;
      z-index: 1;
      display: flex;
      align-items: center;
      height: 100%;
      flex-shrink: 0;
      padding: 0 8px 0 14px;
      border: none;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-tab-inactiveForeground, #999);
      background: linear-gradient(
        to right,
        transparent,
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)) 8px
      );
    }
    .tab-overflow:hover {
      color: var(--vscode-tab-activeForeground, #fff);
    }
    .tab-overflow.tab-overflow-waiting {
      color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .tab-exited .tab-name {
      opacity: 0.5;
      font-style: italic;
    }
    /* Inline-rename overlay input (add-tab-rename design.md D4). Positioned
       absolutely so it survives renderTabBar()'s destructive re-renders. */
    .tab-rename-overlay {
      position: absolute;
      box-sizing: border-box;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 12px);
      padding: 1px 4px;
      margin: 0;
      border: 1px solid var(--vscode-focusBorder, #007acc);
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      z-index: 100;
    }
    /* Strip the browser default outline only when not keyboard-focused (a11y:
       WCAG 2.4.11). Keyboard users still see a focus ring via :focus-visible. */
    .tab-rename-overlay:not(:focus-visible) {
      outline: none;
    }
    .tab-rename-overlay:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, #007acc);
      outline-offset: -1px;
    }
    /* Terminal find widget (Cmd+F / Ctrl+F) — floats over the top-right of
       #terminal-container, styled after VS Code's editor find widget. */
    .terminal-search {
      position: absolute;
      top: 4px;
      right: 18px;
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 2px;
      max-width: calc(100% - 28px);
      padding: 3px 4px;
      box-sizing: border-box;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 12px);
      color: var(--vscode-editorWidget-foreground, #ccc);
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, transparent);
      border-radius: 4px;
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
    }
    .terminal-search[hidden] {
      display: none;
    }
    .terminal-search-input {
      flex: 1 1 160px;
      min-width: 60px;
      width: 180px;
      height: 22px;
      box-sizing: border-box;
      padding: 2px 6px;
      margin-right: 2px;
      font: inherit;
      color: var(--vscode-input-foreground, #ccc);
      background: var(--vscode-input-background, #3c3c3c);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      outline: none;
    }
    .terminal-search-input:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .terminal-search-input.terminal-search-input-invalid {
      border-color: var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .terminal-search-toggle,
    .terminal-search-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      padding: 0;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 3px;
      cursor: pointer;
    }
    .terminal-search-toggle {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }
    .terminal-search-toggle:hover,
    .terminal-search-action:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    }
    .terminal-search-toggle.terminal-search-toggle-on {
      color: var(--vscode-inputOption-activeForeground, #fff);
      background: var(--vscode-inputOption-activeBackground, rgba(0, 127, 212, 0.4));
      border-color: var(--vscode-inputOption-activeBorder, #007acc);
    }
    .terminal-search-toggle:focus-visible,
    .terminal-search-action:focus-visible {
      outline: 1px solid var(--vscode-focusBorder, #007acc);
      outline-offset: -1px;
    }
    .terminal-search-count {
      flex-shrink: 0;
      min-width: 64px;
      padding: 0 4px;
      font-size: 11px;
      white-space: nowrap;
      color: var(--vscode-descriptionForeground, #999);
    }
    .terminal-search-count.terminal-search-count-empty {
      color: var(--vscode-errorForeground, #f48771);
    }
    .error-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      font-size: 12px;
      font-family: var(--vscode-font-family, sans-serif);
      color: #fff;
      z-index: 100;
      flex-shrink: 0;
    }
    .error-banner-error {
      background: #c72e2e;
    }
    .error-banner-warn {
      background: #b5850a;
    }
    .error-banner-info {
      background: #1a6fb5;
    }
    .error-banner-message {
      flex: 1;
      margin-right: 8px;
    }
    .error-banner-dismiss {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
      padding: 0;
      opacity: 0.7;
      border-radius: 3px;
    }
    .error-banner-dismiss:hover {
      opacity: 1;
      background: rgba(255,255,255,0.2);
    }
    #terminal-container {
      flex: 1;
      overflow: hidden;
      padding-left: 8px;
      box-sizing: border-box;
      position: relative;
    }

    /* Drag-drop tip banner — dismissable hint at bottom of terminal */
    .drag-drop-tip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
      font-size: 11px;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-descriptionForeground, #888);
      background: var(--vscode-editorWidget-background, rgba(30, 30, 30, 0.8));
      border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      flex-shrink: 0;
      gap: 8px;
    }
    .drag-drop-tip-text {
      flex: 1;
    }
    .drag-drop-tip-dismiss {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border: none;
      background: transparent;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      opacity: 0.6;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .drag-drop-tip-dismiss:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
    }

    /* Flash effect when path is inserted via context menu —
       uses ::after overlay to cover xterm content */
    @keyframes insert-path-flash {
      0% { opacity: 1; }
      100% { opacity: 0; }
    }
    #terminal-container.path-inserted::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 122, 204, 0.12);
      pointer-events: none;
      z-index: 50;
      animation: insert-path-flash 0.8s ease-out forwards;
    }

    /* Hover-preview popup — see asimov/changes/add-hover-file-preview/design.md D2, D8. */
    .anywhere-hover-preview {
      box-sizing: border-box;
      /* Positioning context for the absolutely-positioned SE resize grip. */
      position: absolute;
      /* Column layout so the header pins to the top and the footer to the
       * bottom while the body grows/scrolls in between — the footer follows the
       * bottom edge as the popup is resized taller. The body is the sole
       * scroller (overflow: hidden here clips to the rounded corners). */
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-editorHoverWidget-background, rgba(30, 30, 30, 0.98));
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground, #ddd));
      border-radius: 6px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
      font-family: var(--vscode-editor-font-family, "Menlo", "Consolas", monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      padding: 0;
      pointer-events: auto;
    }
    .anywhere-hover-preview-header {
      /* Fixed-height row pinned to the top of the flex column. */
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-editorHoverWidget-border, rgba(128, 128, 128, 0.35));
      color: var(--vscode-descriptionForeground, #999);
      font-size: 11px;
      /* The header doubles as the drag handle for moving the popup. */
      cursor: move;
    }
    .anywhere-hover-preview-header-path {
      flex: 1 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      direction: rtl; /* keep the file name visible when the abs path is long */
      text-align: left;
      unicode-bidi: plaintext;
      /* Non-selectable so a header drag doesn't fight text selection. */
      user-select: none;
      -webkit-user-select: none;
      cursor: move;
    }
    .anywhere-hover-preview-open-btn {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 3px;
      color: inherit;
      cursor: pointer;
      opacity: 0.75;
    }
    .anywhere-hover-preview-open-btn:hover,
    .anywhere-hover-preview-open-btn:focus-visible {
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.08));
      opacity: 1;
      outline: none;
    }
    .anywhere-hover-preview-open-btn svg {
      width: 14px;
      height: 14px;
      display: block;
    }
    .anywhere-hover-preview-body {
      /* Grows to fill the space between header and footer and scrolls its own
       * overflow; min-height:0 lets it shrink below content size inside the
       * flex column so the footer stays visible at the bottom. */
      flex: 1 1 auto;
      min-height: 0;
      padding: 8px 10px;
      overflow: auto;
      counter-reset: anywhere-line;
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    }
    .anywhere-hover-preview-body pre,
    .anywhere-hover-preview-plain {
      margin: 0;
      white-space: pre;
      font-family: inherit;
      font-size: inherit;
    }
    /* Markdown body — compact spacing modeled on VSCode's .monaco-hover
     * (src/vs/base/browser/ui/hover/hoverWidget.css). Prose wraps softly;
     * only fenced code keeps white-space:pre so long lines scroll. */
    .anywhere-hover-preview-md {
      white-space: normal;
      word-wrap: break-word;
      line-height: 1.5;
    }
    .anywhere-hover-preview-md p,
    .anywhere-hover-preview-md ul,
    .anywhere-hover-preview-md ol,
    .anywhere-hover-preview-md blockquote,
    .anywhere-hover-preview-md table,
    .anywhere-hover-preview-md pre,
    .anywhere-hover-preview-md h1,
    .anywhere-hover-preview-md h2,
    .anywhere-hover-preview-md h3,
    .anywhere-hover-preview-md h4,
    .anywhere-hover-preview-md h5,
    .anywhere-hover-preview-md h6 {
      margin: 8px 0;
    }
    .anywhere-hover-preview-md h1,
    .anywhere-hover-preview-md h2,
    .anywhere-hover-preview-md h3,
    .anywhere-hover-preview-md h4,
    .anywhere-hover-preview-md h5,
    .anywhere-hover-preview-md h6 {
      line-height: 1.1;
    }
    .anywhere-hover-preview-md h1 { font-size: 1.4em; }
    .anywhere-hover-preview-md h2 { font-size: 1.2em; }
    .anywhere-hover-preview-md h3 { font-size: 1.05em; }
    .anywhere-hover-preview-md h4,
    .anywhere-hover-preview-md h5,
    .anywhere-hover-preview-md h6 { font-size: 1em; }
    .anywhere-hover-preview-md > :first-child { margin-top: 0; }
    .anywhere-hover-preview-md > :last-child  { margin-bottom: 0; }
    .anywhere-hover-preview-md ul,
    .anywhere-hover-preview-md ol { padding-left: 20px; }
    .anywhere-hover-preview-md li > p  { margin-bottom: 0; }
    .anywhere-hover-preview-md li > ul,
    .anywhere-hover-preview-md li > ol { margin-top: 0; }
    .anywhere-hover-preview-md pre.shiki {
      white-space: pre;
    }
    /* Shiki sets its theme's background-color inline on the <pre class="shiki">.
     * That clashes with the popup chrome's editorHoverWidget background — on
     * horizontal scroll the right edge shows a different shade of dark, and
     * Shiki's bg over a non-matching popup bg looks like a "selected" block.
     * Override to transparent so the popup's background shows through
     * uniformly; tokens still keep their per-token foreground colors.
     * min-width:100% prevents short content from leaving a strip of popup bg
     * to the right of the Shiki pre. */
    .anywhere-hover-preview pre.shiki,
    .anywhere-hover-preview pre.shiki code,
    .anywhere-hover-preview-md pre.shiki,
    .anywhere-hover-preview-md pre.shiki code {
      background: transparent !important;
      background-color: transparent !important;
      min-width: 100%;
      box-sizing: border-box;
    }
    /* CSS-counter gutter — works for both Shiki output and the plain-text
     * fallback because both wrap each line in span.line. */
    .anywhere-hover-preview-body .line {
      counter-increment: anywhere-line;
      position: relative;
    }
    .anywhere-hover-preview-body-numbers .line::before {
      content: counter(anywhere-line);
      display: inline-block;
      width: 3ch;
      margin-right: 12px;
      color: var(--vscode-editorLineNumber-foreground, #858585);
      text-align: right;
      user-select: none;
      opacity: 0.7;
    }
    .anywhere-hover-preview-placeholder {
      padding: 4px 0;
      color: var(--vscode-descriptionForeground, #999);
    }
    /* Pasted-image preview body — the blob: object URL renders here, filling the
       popup's content width with height scaled by aspect ratio (see
       preview-pasted-images design.md D4/D6). The popup body has overflow:auto,
       so a tall image scrolls. CSP img-src must allow blob: for this to load. */
    .anywhere-hover-preview-image {
      display: block;
      width: 100%;
      height: auto;
    }
    .anywhere-hover-preview-truncated {
      margin-top: 6px;
      color: var(--vscode-descriptionForeground, #999);
      font-style: italic;
      font-size: 11px;
    }
    .anywhere-hover-preview-md a {
      pointer-events: none;
      text-decoration: underline;
      color: var(--vscode-textLink-foreground, #4daafc);
    }
    /* Footer toolbar — toggles for wrap/auto + delay input. See: design.md D17. */
    .anywhere-hover-preview-footer {
      /* Fixed-height row pinned to the bottom of the flex column — it follows
       * the bottom edge as the popup is resized taller. */
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 10px;
      border-top: 1px solid var(--vscode-editorHoverWidget-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-editorHoverWidget-statusBarBackground, rgba(255, 255, 255, 0.03));
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
    }
    .anywhere-hover-preview-footer-toggle,
    .anywhere-hover-preview-footer-delay {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
    }
    .anywhere-hover-preview-footer-delay {
      margin-left: auto;
    }
    .anywhere-hover-preview-footer-delay input {
      width: 56px;
      padding: 2px 4px;
      background: var(--vscode-input-background, rgba(0, 0, 0, 0.2));
      color: var(--vscode-input-foreground, inherit);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-size: 11px;
    }
    .anywhere-hover-preview-footer input[type="checkbox"] {
      cursor: pointer;
    }
    /* SE-corner resize grip. Dragging it resizes the live popup; the size is
     * not persisted — the next hover re-creates the popup at the default size.
     * Two short diagonal lines hint at the affordance. */
    .anywhere-hover-preview-resize-grip {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      z-index: 1;
      background-image: linear-gradient(
        135deg,
        transparent 0%,
        transparent 45%,
        var(--vscode-descriptionForeground, #999) 45%,
        var(--vscode-descriptionForeground, #999) 55%,
        transparent 55%,
        transparent 70%,
        var(--vscode-descriptionForeground, #999) 70%,
        var(--vscode-descriptionForeground, #999) 80%,
        transparent 80%
      );
      opacity: 0.5;
    }
    .anywhere-hover-preview-resize-grip:hover {
      opacity: 0.9;
    }
    /* Highlight the line referenced by path:LineNo / path#LineNo. */
    .anywhere-hover-preview .line.anywhere-hover-preview-line-active {
      background-color: var(--vscode-editor-rangeHighlightBackground, rgba(255, 200, 0, 0.15));
      box-shadow: inset 2px 0 0 var(--vscode-editorWarning-foreground, #cca700);
      display: inline-block;
      min-width: 100%;
    }

    /* Split handle — visible 1px separator at rest, full sash on hover */
    .split-handle {
      flex: 0 0 4px;
      position: relative;
      background: transparent;
      opacity: 1;
      transition: background 0.15s ease;
    }
    .split-handle::after {
      content: '';
      position: absolute;
    }
    .split-handle[data-direction="vertical"]::after {
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      transform: translateX(-50%);
      background: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    }
    .split-handle[data-direction="horizontal"]::after {
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      transform: translateY(-50%);
      background: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    }
    .split-handle:hover,
    .split-handle:active {
      background: var(--vscode-sash-hoverBorder, rgba(128, 128, 128, 0.35));
    }
    .split-handle:hover::after,
    .split-handle:active::after {
      background: transparent;
    }
    .split-handle[data-direction="vertical"] {
      cursor: col-resize;
    }
    .split-handle[data-direction="horizontal"] {
      cursor: row-resize;
    }

    /* Hide xterm's overview-ruler lane (the colored decoration marker
       strip on the right edge — distinct from the scrollbar). The
       scrollbar itself uses xterm v6's Monaco-style SmoothScrollableElement
       which auto-shows on hover/scroll and pulls its slider colours from
       ThemeManager's --vscode-scrollbarSlider-* mapping, matching the
       file-tree list scrollbar exactly. */
    .xterm .xterm-decoration-overview-ruler {
      opacity: 0 !important;
      pointer-events: none !important;
    }
  </style>
</head>
<body data-terminal-location="${location}">
  <!-- Webview layout wrapper. The terminal area and the #aux-region are
       siblings; CSS in fileTreePanel.css drives flex direction and child order
       via the file-tree--{top|bottom|left|right} classes set at runtime by
       FileTreePanel.setPosition(). The region is always shown; users minimize
       each section by collapsing it (.file-tree--root-collapsed / .vault-collapsed). -->
  <div id="webview-layout" class="webview-layout file-tree--bottom">
    <div class="terminal-area">
      <div id="tab-bar"></div>
      <div id="terminal-container"></div>
    </div>
    <!-- Sidebar region — the sized edge slot. Holds the vault section stacked
         directly above the file tree; both collapse independently to a header
         strip. The resize sash mounts here (resizes the whole region). -->
    <div id="aux-region" class="aux-region">
      <div id="vault-panel" class="vault-panel vault-collapsed"></div>
      <div id="file-tree" class="file-tree-panel"></div>
    </div>
  </div>
  <div id="drag-drop-tip"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
