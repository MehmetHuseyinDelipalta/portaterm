import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const files = [
  "docs/design/worktree-scope.md",
  "docs/design/worktree-panel-ui.md",
  "docs/design/worktree-agent-presence.md",
  "docs/design/worktree-rpc.md",
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
});
