// Repro for 260906-at-session-owner-other-window.
//
// A claude session started by ANOTHER app (orca spawns `claude` under its own
// daemon, nowhere near a VS Code pty) shares a directory with a plain AT shell
// pane. `resolveClaudeSession` step 1 asks the process table, is told the
// session's pid is not in this pane's subtree, and then falls through to step 2
// which matches on cwd alone. The pane claims the session, the row renders as
// this window's, and `externalRows` drops the real one — so the "other window"
// chip never appears for a session this window does not run.
//
// Driven through the production wiring (registry file on disk, presenceDeps,
// projector) and rendered with the production row renderer, because the report
// is about what the panel shows.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JSDOM } from "jsdom";
import { createPaneEvidenceStore } from "../../../src/session/PaneEvidenceStore";
import { listRunningClaudeSessions } from "../../../src/vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "../../../src/worktree/presenceDeps";
import { createPresenceProjector } from "../../../src/worktree/presenceProjector";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(globalThis as unknown as { Node: unknown }).Node = dom.window.Node;

const { renderAgentRow } = await import("../../../src/webview/worktree/worktreeTreeView");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-other-window-")));
const configDir = path.join(root, "claude");
fs.mkdirSync(path.join(configDir, "sessions"), { recursive: true });

const REPO = path.join(root, "cyberk-skills");
fs.mkdirSync(REPO, { recursive: true });

// The orca-run session: busy, in REPO, with a pid this window's process table
// positively places OUTSIDE every pane subtree.
const ORCA_PID = 16_716;
const ORCA_SESSION = "f0c6ab01-86a5-4b9d-98ce-7bfbd2728820";
fs.writeFileSync(
  path.join(configDir, "sessions", `${ORCA_PID}.json`),
  JSON.stringify({
    pid: ORCA_PID,
    sessionId: ORCA_SESSION,
    cwd: REPO,
    startedAt: 1_788_583_424_278,
    kind: "interactive",
    entrypoint: "cli",
    name: "cyberk-skills-3b",
    nameSource: "derived",
    status: "busy",
    statusUpdatedAt: 1_788_679_785_836,
  }),
);

// One AT pane: a plain shell sitting in the same directory. Nothing under it.
const store = createPaneEvidenceStore();
store.create("pane-shell", { cwd: REPO, viewId: "v1", ptyPid: 2000, shell: "zsh" });

const deps = createPresenceProjectorDeps({
  store,
  listRunning: () => listRunningClaudeSessions({ configDir }, { isAlive: () => true }),
  sessionMtime: async () => undefined,
  sessionTitle: async () => undefined,
  sessionUnderCwd: async () => undefined,
  table: {
    open: async () => ({
      // Readable, and definitive: pane 2000 owns nothing.
      descendantsOf: () => ({ kind: "ok" as const, pids: [] as number[] }),
    }),
  } as never,
});
const projector = createPresenceProjector(deps);

const presence = await projector.project([path.resolve(REPO)]);
const rows = Object.values(presence.rowsByWorktreeId).flat();

let failed = 0;
function observe(n: number, what: string, ok: boolean, detail: string): void {
  console.log(`OBSERVES ${n}: ${ok ? "GREEN" : "RED"} — ${what}: ${detail}`);
  if (!ok) {
    failed += 1;
  }
}

const ENTRY = `claude:${ORCA_SESSION}`;
const paneRow = rows.find((r) => r.paneId === "pane-shell");
observe(
  1,
  "a shell pane does not claim a session whose pid this window's process table places outside its pty",
  paneRow?.entryId === undefined,
  `pane-shell entryId=${JSON.stringify(paneRow?.entryId)} agentSource=${JSON.stringify(paneRow?.agentSource)} scope=${JSON.stringify(paneRow?.scope)}`,
);

const sessionRow = rows.find((r) => r.entryId === ENTRY);
const rendered =
  sessionRow === undefined
    ? undefined
    : renderAgentRow(sessionRow, { activity: sessionRow.activity, now: Date.now() }, { onActivate: () => {} });
const chip = rendered?.querySelector(".wt-scope")?.textContent ?? "";
observe(
  2,
  'the session another app is running is rendered with the "other window" chip',
  sessionRow?.scope === "external" && chip.includes("other window"),
  `row=${sessionRow === undefined ? "MISSING" : `scope=${JSON.stringify(sessionRow.scope)} rowId=${JSON.stringify(sessionRow.rowId)}`} chip=${JSON.stringify(chip)}`,
);

fs.rmSync(root, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
