import { describe, expect, it } from "vitest";
import { claudeEntryId, claudeResumeArgs, isClaudeExecutable } from "./agentLaunchResume";

const ID = "0f7af73f-7dba-4817-9b6e-e3bb63d0ecb0";

describe("isClaudeExecutable", () => {
  it("recognises claude by name, by path, and as a Windows shim", () => {
    for (const shell of ["claude", "/opt/homebrew/bin/claude", "C:\\npm\\claude.cmd", "claude.exe", "CLAUDE"]) {
      expect(isClaudeExecutable(shell), shell).toBe(true);
    }
  });

  it("refuses every other executable", () => {
    for (const shell of ["codex", "/bin/zsh", "claude-dev", "myclaude", "/claude/bin/opencode", ""]) {
      expect(isClaudeExecutable(shell), shell).toBe(false);
    }
  });
});

describe("claudeResumeArgs", () => {
  it("resumes the session with no args to keep", () => {
    expect(claudeResumeArgs([], ID)).toEqual(["--resume", ID]);
  });

  it("drops a positional prompt and an earlier resume, keeping the run settings", () => {
    expect(claudeResumeArgs(["--resume", "old", "--model", "opus", "--permission-mode", "plan"], ID)).toEqual([
      "--resume",
      ID,
      "--model",
      "opus",
      "--permission-mode",
      "plan",
    ]);
    expect(claudeResumeArgs(["--permission-mode", "acceptEdits", "write the tests"], ID)).toEqual([
      "--resume",
      ID,
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("keeps the --flag=value form, and a flag value that looks like a prompt", () => {
    expect(claudeResumeArgs(["--model=opus[1m]", "--permission-mode", "default"], ID)).toEqual([
      "--resume",
      ID,
      "--model=opus[1m]",
      "--permission-mode",
      "default",
    ]);
  });

  it("drops a trailing kept flag that has no value", () => {
    expect(claudeResumeArgs(["--model"], ID)).toEqual(["--resume", ID]);
  });
});

describe("claudeEntryId", () => {
  it("names the Claude vault entry", () => {
    expect(claudeEntryId(ID)).toBe(`claude:${ID}`);
  });
});
