// src/test/isolatedHome.ts — Give the whole suite a throwaway home directory.
//
// Tests that run the real `activate()` reconcile agent hooks against whatever
// `os.homedir()` names. Under the `vscode` mock every opt-in reads as false, so
// that reconciliation is a removal — and against the developer's real home it
// stripped Portaterm's entries out of `~/.claude/settings.json`, leaving Claude
// panes with no hook reports (no "running" mark) until the next window reload.
//
// Runs as a `globalSetup`, so it executes in the main process before the worker
// pool exists and every worker inherits the redirected environment.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REDIRECTED = ["HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME"] as const;

export default function setup(): () => void {
  const saved = new Map(REDIRECTED.map((key) => [key, process.env[key]]));
  const home = mkdtempSync(path.join(tmpdir(), "portaterm-test-home-"));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.XDG_CONFIG_HOME;

  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(home, { recursive: true, force: true });
  };
}
