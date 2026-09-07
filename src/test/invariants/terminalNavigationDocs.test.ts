import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const files = [
  "docs/design/worktree-scope.md",
  "docs/design/worktree-panel-ui.md",
  "docs/design/worktree-agent-presence.md",
  "docs/design/worktree-rpc.md",
  "docs/design/xterm-integration.md",
  "docs/design/session-manager.md",
  "docs/design/message-protocol.md",
  "docs/DESIGN.md",
] as const;

const read = (file: (typeof files)[number]): string => fs.readFileSync(path.join(root, file), "utf8");

describe("terminal navigation documentation", () => {
  it("retires independent scope, selection, and inspector contracts everywhere", () => {
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/selectedWorktreeId|worktreeScope|resetWorktreeScope/i);
      expect(text, file).not.toMatch(/\bAll\b\s+(?:control|escape|chip)|escape hatch/i);
      expect(text, file).not.toMatch(/\binspector\b/i);
    }
  });

  it("defines stable total owner and atomic per-surface navigation", () => {
    const text = read("docs/design/worktree-scope.md");
    expect(text).toContain("TerminalOwner");
    expect(text).toMatch(/Main is one global owner/i);
    expect(text).toMatch(/stable `worktreeId`/i);
    expect(text).toMatch(/owner, tab, and pane.*atomically/i);
    expect(text).toMatch(/per surface/i);
    expect(text).toMatch(/presence.*never.*ownership/is);
  });

  it("defines linked-only row marks independent from keyboard focus", () => {
    const text = read("docs/design/worktree-panel-ui.md");
    expect(text).toMatch(/active linked owner/i);
    expect(text).toMatch(/Main.*marks no worktree row/i);
    expect(text).toMatch(/keyboard focus.*independent/i);
    expect(text).toMatch(/one owner-navigation transition/i);
  });

  it("limits presence to activity decoration and cwd-based rows", () => {
    const text = read("docs/design/worktree-agent-presence.md");
    expect(text).toMatch(/presence does not own terminal ownership/i);
    expect(text).toMatch(/`cd`.*does not change.*owner/is);
    expect(text).toMatch(/waiting.*decoration/is);
  });

  it("records the nullable committed navigation pair separately from worktree actions", () => {
    const text = read("docs/design/worktree-rpc.md");
    expect(text).toContain("terminalNavigationCommitted");
    expect(text).toMatch(/activeTabId.*activePaneId.*nullable pair/is);
    expect(text).toMatch(/worktree row activation.*webview-local owner intent/i);
  });

  it("documents controller-owned xterm navigation and correlated split completion", () => {
    const text = read("docs/design/xterm-integration.md");
    expect(text).toContain("TerminalNavigationController.transaction");
    expect(text).toMatch(/requestId, sourceTabId, sourcePaneId, direction/);
    expect(text).toContain("splitPaneAttachmentResult");
    expect(text).toMatch(/snapshot replay order never.*chooses the active tab/is);
    expect(text).not.toMatch(/store\.activeTabId\s*=|postMessage\(\{type:'switchTab'/);
  });

  it("documents stable SessionManager ownership and atomic routing", () => {
    const text = read("docs/design/session-manager.md");
    expect(text).toMatch(/stable optional.*`worktreeId`/is);
    expect(text).toContain("commitNavigation(viewId, activeTabId, activePaneId)");
    expect(text).toMatch(/Partial pairs, unknown panes, wrong views, and mismatched roots are rejected/);
    expect(text).toMatch(/Snapshot replay order therefore cannot choose navigation/);
  });

  it("documents committed navigation and legacy message boundaries", () => {
    const text = read("docs/design/message-protocol.md");
    expect(text).toMatch(/`focus`.*recency only/);
    expect(text).toMatch(/`switchTab`.*Deprecated compatibility message/);
    expect(text).toMatch(/`terminalNavigationCommitted`.*Nullable/);
    expect(text).toContain("splitPaneAttachmentResult");
  });

  it("supersedes reset-based restore in the architecture registry", () => {
    const text = read("docs/DESIGN.md");
    expect(text).toMatch(/D50.*Superseded by D51/);
    expect(text).toMatch(/D51.*V1 checkpoint/);
    expect(text).toContain("I22");
  });
});
