import { describe, expect, it } from "vitest";
import {
  confirmKill,
  type KillConfirmationUi,
  type KillEvidenceReader,
  paneSessionIdsOf,
  runningAgentPanes,
} from "./killConfirmation";

type Pane = { exited: boolean; isAgentLaunch?: boolean; shell?: string };

function evidence(panes: Record<string, Pane>): KillEvidenceReader {
  return { read: (id) => panes[id] };
}

/** Records what was asked, and answers with `answer` (undefined = dismissed). */
function ui(answer?: string): KillConfirmationUi & { asked: { message: string; detail?: string }[] } {
  const asked: { message: string; detail?: string }[] = [];
  return {
    asked,
    showWarningMessage(message, options) {
      asked.push({ message, detail: options.detail });
      return Promise.resolve(answer);
    },
  };
}

describe("runningAgentPanes", () => {
  it("names the agent panes and nothing else", () => {
    const found = runningAgentPanes(
      ["shell", "agent", "gone"],
      evidence({
        shell: { exited: false, isAgentLaunch: false, shell: "zsh" },
        agent: { exited: false, isAgentLaunch: true, shell: "claude" },
        gone: { exited: true, isAgentLaunch: true, shell: "codex" },
      }),
    );
    expect(found).toEqual([{ sessionId: "agent", name: "claude" }]);
  });

  it("excludes a pane whose process has already exited", () => {
    // There is nothing left to kill, and the row survives in the store only so
    // the pane can keep reading `exited` until it closes.
    const panes = { a: { exited: true, isAgentLaunch: true, shell: "claude" } };
    expect(runningAgentPanes(["a"], evidence(panes))).toEqual([]);
    // Non-vacuous: the same pane, still running, is found.
    expect(runningAgentPanes(["a"], evidence({ a: { ...panes.a, exited: false } }))).toHaveLength(1);
  });

  it("treats an unreported pane as nothing to warn about", () => {
    // `undefined` means nothing has told us, which is not a claim that an agent
    // is running — a confirmation on it would fire on every ordinary close.
    expect(runningAgentPanes(["never-seen"], evidence({}))).toEqual([]);
  });

  it("counts a pane named twice once", () => {
    const found = runningAgentPanes(
      ["a", "a"],
      evidence({ a: { exited: false, isAgentLaunch: true, shell: "claude" } }),
    );
    expect(found).toHaveLength(1);
  });

  it("asks about nothing when the host kept no evidence store", () => {
    expect(runningAgentPanes(["a"], null)).toEqual([]);
  });
});

describe("paneSessionIdsOf", () => {
  it("keeps the carried panes, which already include the tab", () => {
    expect(paneSessionIdsOf({ tabId: "t", paneSessionIds: ["t", "p2"] })).toEqual(["t", "p2"]);
  });

  it("falls back to the tab id when the field is absent or malformed", () => {
    expect(paneSessionIdsOf({ tabId: "t" })).toEqual(["t"]);
    expect(paneSessionIdsOf({ tabId: "t", paneSessionIds: "p2" })).toEqual(["t"]);
  });

  it("drops non-string entries and still names the tab", () => {
    // A malformed entry is no claim, not a lesser one; the tab id is the value
    // the host already routes on.
    expect(paneSessionIdsOf({ tabId: "t", paneSessionIds: [1, "", "p2", null] })).toEqual(["t", "p2"]);
  });
});

describe("confirmKill", () => {
  const AGENT = evidence({ a: { exited: false, isAgentLaunch: true, shell: "claude" } });

  it("asks nothing and proceeds when no agent is running", async () => {
    const asker = ui("Close Tab");
    await expect(confirmKill(["a"], "tab", evidence({ a: { exited: false, shell: "zsh" } }), asker)).resolves.toBe(
      true,
    );
    expect(asker.asked).toEqual([]);
  });

  it("proceeds only on the confirm button", async () => {
    await expect(confirmKill(["a"], "tab", AGENT, ui("Close Tab"))).resolves.toBe(true);
    // Escape and the dialog's own Cancel both arrive as `undefined`.
    await expect(confirmKill(["a"], "tab", AGENT, ui(undefined))).resolves.toBe(false);
  });

  it("words the question and the button for the thing being closed", async () => {
    const tab = ui();
    await confirmKill(["a"], "tab", AGENT, tab);
    expect(tab.asked[0]?.message).toBe("Close this terminal tab?");
    const pane = ui();
    await confirmKill(["a"], "pane", AGENT, pane);
    expect(pane.asked[0]?.message).toBe("Close this terminal pane?");
    const terminal = ui();
    await confirmKill(["a"], "terminal", AGENT, terminal);
    expect(terminal.asked[0]?.message).toBe("Kill this terminal?");
  });

  it("names the agents, because the count alone does not let the user decide", async () => {
    const one = ui();
    await confirmKill(["a"], "tab", AGENT, one);
    expect(one.asked[0]?.detail).toContain("claude is still running here");

    const many = ui();
    await confirmKill(
      ["a", "b"],
      "tab",
      evidence({
        a: { exited: false, isAgentLaunch: true, shell: "claude" },
        b: { exited: false, isAgentLaunch: true, shell: "codex" },
      }),
      many,
    );
    expect(many.asked[0]?.detail).toContain("2 agents are still running here (claude, codex)");
  });

  it("still asks about a pane whose shell was never reported", async () => {
    // The identity is unknown, but the launch fact is not — withholding the
    // question would be the silent close this exists to stop.
    const asker = ui();
    await confirmKill(["a"], "pane", evidence({ a: { exited: false, isAgentLaunch: true } }), asker);
    expect(asker.asked[0]?.detail).toContain("An agent is still running here");
  });
});
