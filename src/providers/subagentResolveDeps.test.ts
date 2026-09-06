// src/providers/subagentResolveDeps.test.ts — the shipped disk selector behind
// the subagent-preview path.
//
// Round-1 F001: the resolver names the sessions a conclusive process-table read
// has refuted, and this selector is what must walk PAST them. The resolver's own
// re-check would turn a leak into a `null`, so only a test at this seam can show
// the difference between "refused everything" and "found the eligible one".

import { describe, expect, it, vi } from "vitest";
import type { SessionManager } from "../session/SessionManager";
import { readClaudeSessions } from "../vault/readers/claudeReader";
import { subagentResolveDeps } from "./webviewRequests";

vi.mock("../vault/readers/claudeReader", () => ({
  readClaudeSessions: vi.fn(),
  claudeSessionMtime: vi.fn(async () => 0),
}));

const CWD = "/work/proj";

function entries(...rows: Array<{ sessionId: string; cwd: string; modified: number; agent?: string }>) {
  return {
    entries: rows.map((row) => ({ agent: "claude", ...row })),
  };
}

/** Only `newestSessionUnderCwd` is under test; nothing else here is called. */
const NO_SESSIONS = {} as unknown as SessionManager;

describe("subagentResolveDeps — newest session under cwd", () => {
  it("skips a refuted live transcript and keeps looking, rather than stopping at it", async () => {
    // The live one is NEWER, which is the whole hazard: a selector that ignored
    // the exclusion would return it and the pane's own exited session would be
    // invisible behind it.
    vi.mocked(readClaudeSessions).mockResolvedValue(
      entries(
        { sessionId: "theirs-live", cwd: CWD, modified: 900 },
        { sessionId: "ours-exited", cwd: CWD, modified: 100 },
      ) as never,
    );

    const found = await subagentResolveDeps(NO_SESSIONS).newestSessionUnderCwd(CWD, new Set(["theirs-live"]));

    expect(found).toEqual({ sessionId: "ours-exited", cwd: CWD });
  });

  it("returns nothing when every candidate under the directory was refuted", async () => {
    vi.mocked(readClaudeSessions).mockResolvedValue(
      entries({ sessionId: "theirs-live", cwd: CWD, modified: 900 }) as never,
    );

    expect(await subagentResolveDeps(NO_SESSIONS).newestSessionUnderCwd(CWD, new Set(["theirs-live"]))).toBeNull();
  });

  it("keeps the newest when nothing is excluded, which is the unreadable-table path", async () => {
    vi.mocked(readClaudeSessions).mockResolvedValue(
      entries(
        { sessionId: "theirs-live", cwd: CWD, modified: 900 },
        { sessionId: "ours-exited", cwd: CWD, modified: 100 },
      ) as never,
    );

    const found = await subagentResolveDeps(NO_SESSIONS).newestSessionUnderCwd(CWD, new Set());

    expect(found).toEqual({ sessionId: "theirs-live", cwd: CWD });
  });

  it("still ignores another agent's session and another directory's", async () => {
    vi.mocked(readClaudeSessions).mockResolvedValue(
      entries(
        { sessionId: "codex-here", cwd: CWD, modified: 900, agent: "codex" },
        { sessionId: "claude-elsewhere", cwd: "/other", modified: 800 },
        { sessionId: "ours", cwd: CWD, modified: 100 },
      ) as never,
    );

    const found = await subagentResolveDeps(NO_SESSIONS).newestSessionUnderCwd(CWD, new Set());

    expect(found).toEqual({ sessionId: "ours", cwd: CWD });
  });
});
