// src/session/SessionManager.lateExit.test.ts — a closed tab's process must not
// reach the session after it is gone.
//
// `PtySession.kill()` is graceful: it waits for 250 ms of output silence, then
// sends SIGHUP, so the real exit arrives well after `performDestroy` has run
// `cleanupSession` and taken the id out of `terminalBeingKilled`. The other
// SessionManager suites mock PtySession and fire `onExit` by hand while the id
// is still being killed, which is why none of them saw this. Here the REAL
// PtySession runs against a fake node-pty whose process exits only when killed,
// on fake timers, so the late exit and the late output arrive exactly when they
// would in the extension.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodePtyModule, Pty, PtyForkOptions } from "../pty/PtyManager";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { headlessFactories, mockWebview } from "../test/sessionMocks";

/** One fake process per spawn, in spawn order. */
interface FakeProcess {
  file: string;
  args: string[];
  options: PtyForkOptions;
  killed: string[];
  emitData(data: string): void;
  /** The process ends by itself (the agent quit) — no signal from the session. */
  exit(code: number): void;
}

const spawned = vi.hoisted(() => [] as FakeProcess[]);

/** How long the fake process takes to die after it is signalled. */
const EXIT_AFTER_SIGNAL_MS = 5;

const fakeNodePty: NodePtyModule = {
  spawn(file, args, options) {
    const dataListeners = new Set<(d: string) => void>();
    const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>();
    let dead = false;
    const proc: FakeProcess = {
      file,
      args,
      options,
      killed: [],
      emitData: (d) => {
        if (!dead) {
          for (const l of dataListeners) {
            l(d);
          }
        }
      },
      exit: (exitCode) => {
        if (dead) {
          return;
        }
        dead = true;
        for (const l of exitListeners) {
          l({ exitCode });
        }
      },
    };
    spawned.push(proc);
    const pty: Pty = {
      pid: 40_000 + spawned.length,
      cols: options.cols ?? 80,
      rows: options.rows ?? 30,
      write: () => {},
      resize: () => {},
      pause: () => {},
      resume: () => {},
      kill: (signal = "SIGHUP") => {
        proc.killed.push(signal);
        setTimeout(() => proc.exit(129), EXIT_AFTER_SIGNAL_MS);
      },
      onData: (l) => {
        dataListeners.add(l);
        return { dispose: () => dataListeners.delete(l) };
      },
      onExit: (l) => {
        exitListeners.add(l);
        return { dispose: () => exitListeners.delete(l) };
      },
    };
    return pty;
  },
};

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => ({
  loadNodePty: () => fakeNodePty,
  detectShell: () => ({ shell: "/bin/zsh", args: ["--login"] }),
  buildEnvironment: () => ({ PATH: "/usr/bin" }),
  resolveWorkingDirectory: () => "/tmp",
}));
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  spawned.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function newSM() {
  const fx = headlessFactories({ track: true });
  const sm = new SessionManager(undefined, {
    restoreEnabled: true,
    headlessFactory: fx.headless,
    serializeAddonFactory: fx.serialize,
  });
  return { sm, mirrors: fx.builtHeadless };
}

const agent = { shell: "claude", shellArgs: ["--resume", "x"], isAgentLaunch: true };
const posted = (webview: ReturnType<typeof mockWebview>) =>
  (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(([m]) => (m as { type: string }).type);

describe("a closed tab's process arriving after the session is gone", () => {
  it("does not respawn a fallback shell when an agent tab is closed while the agent runs", async () => {
    const { sm } = newSM();
    const webview = mockWebview();
    const respawn = vi.spyOn(sm as unknown as { respawnFallbackShell: () => void }, "respawnFallbackShell");
    const id = sm.createSession("sidebar", webview, agent);
    expect(spawned).toHaveLength(1);

    sm.destroySession(id);
    // performDestroy's own tick: the session is cleaned up and the id leaves
    // `terminalBeingKilled` — the process has not even been signalled yet.
    await vi.advanceTimersByTimeAsync(1);
    expect(sm.getSession(id)).toBeUndefined();
    expect(spawned[0].killed).toEqual([]);

    // The 250 ms flush, SIGHUP, and the process going away.
    await vi.advanceTimersByTimeAsync(300 + EXIT_AFTER_SIGNAL_MS);
    expect(spawned[0].killed).toEqual(["SIGHUP"]);

    expect(respawn).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(1); // no ownerless login shell
    expect(sm.getSession(id)).toBeUndefined();
    expect(posted(webview)).not.toContain("exit");
    sm.dispose();
  });

  it("does not rebuild a headless mirror from output in the flush window", async () => {
    const { sm, mirrors } = newSM();
    const id = sm.createSession("sidebar", mockWebview());
    spawned[0].emitData("prompt$ ");
    expect(mirrors).toHaveLength(1);

    sm.destroySession(id);
    await vi.advanceTimersByTimeAsync(1);
    expect(sm.getSession(id)).toBeUndefined();
    expect(mirrors[0].disposed).toBe(true);

    // The shell prints while it is being shut down: inside the 250 ms window.
    spawned[0].emitData("logout\r\n");
    spawned[0].emitData("[Process completed]\r\n");
    await vi.advanceTimersByTimeAsync(300 + EXIT_AFTER_SIGNAL_MS);

    expect(mirrors).toHaveLength(1); // nothing re-created for a session that is gone
    sm.dispose();
  });

  it("does not respawn a fallback shell for an agent tab still running at shutdown", async () => {
    const { sm } = newSM();
    sm.createSession("sidebar", mockWebview(), agent);

    sm.dispose();
    await vi.advanceTimersByTimeAsync(300 + EXIT_AFTER_SIGNAL_MS);

    expect(spawned[0].killed).toEqual(["SIGHUP"]);
    expect(spawned).toHaveLength(1);
  });

  it("still respawns a fallback shell when the agent exits on its own", async () => {
    // The pair to the above: the guard must not swallow the case the fallback
    // exists for. The agent quits (Ctrl+C / done) while its tab stays open.
    const { sm } = newSM();
    const id = sm.createSession("sidebar", mockWebview(), agent);

    spawned[0].exit(0);

    expect(spawned).toHaveLength(2);
    expect(spawned[1].file).toBe("/bin/zsh");
    expect(sm.getSession(id)?.state).toBe("live");
    sm.dispose();
  });

  it("detaches the session's handlers from the PTY before killing it", async () => {
    const { sm } = newSM();
    const id = sm.createSession("sidebar", mockWebview(), agent);
    const pty = sm.getSession(id)?.pty as unknown as Callbacks;
    expect(pty._onDataCallback).toBeTypeOf("function");

    sm.destroySession(id);
    await vi.advanceTimersByTimeAsync(0);

    expect(pty._onDataCallback).toBeUndefined();
    expect(pty._onExitCallback).toBeUndefined();
    sm.dispose();
  });
});

describe("detaching at shutdown", () => {
  it("detaches every session's handlers from its PTY on dispose", () => {
    const { sm } = newSM();
    const id = sm.createSession("sidebar", mockWebview(), agent);
    const pty = sm.getSession(id)?.pty as unknown as Callbacks;

    sm.dispose();

    expect(pty._onDataCallback).toBeUndefined();
    expect(pty._onExitCallback).toBeUndefined();
  });
});

/** PtySession's private callback slots — setters only, so read them directly. */
interface Callbacks {
  _onDataCallback?: (d: string) => void;
  _onExitCallback?: (code: number) => void;
}

// Each layer on its own: a handler captured BEFORE the detach (any holder the
// detach cannot reach) must still find the session gone, and the snapshot
// collaborator must refuse a dead session even when called directly.
describe("the guards behind the detach", () => {
  it("a handler captured before the close neither respawns nor rebuilds anything", async () => {
    const { sm, mirrors } = newSM();
    const webview = mockWebview();
    const id = sm.createSession("sidebar", webview, agent);
    spawned[0].emitData("thinking…");
    const pty = sm.getSession(id)?.pty as unknown as Callbacks;
    const late = { data: pty._onDataCallback, exit: pty._onExitCallback };

    sm.destroySession(id);
    await vi.advanceTimersByTimeAsync(1);
    expect(sm.getSession(id)).toBeUndefined();

    late.data?.("late output");
    late.exit?.(129);

    expect(spawned).toHaveLength(1);
    expect(mirrors).toHaveLength(1);
    expect(posted(webview)).not.toContain("exit");
    sm.dispose();
  });

  it("a data handler captured before the close writes to no buffer or scrollback", async () => {
    const { sm } = newSM();
    const id = sm.createSession("sidebar", mockWebview());
    spawned[0].emitData("prompt$ ");
    const session = sm.getSession(id)!;
    const append = session.outputBuffer.append as ReturnType<typeof vi.fn>;
    const before = { appends: append.mock.calls.length, scrollback: [...session.scrollbackCache] };
    const late = (session.pty as unknown as Callbacks)._onDataCallback;

    sm.destroySession(id);
    late?.("late output");
    await vi.advanceTimersByTimeAsync(1);
    late?.("later output");

    expect(append.mock.calls.length).toBe(before.appends);
    expect(session.scrollbackCache).toEqual(before.scrollback);
    sm.dispose();
  });

  it("a handler captured before the close is inert while the destroy is still queued", () => {
    // "destroying" is set synchronously; performDestroy has not run yet.
    const { sm } = newSM();
    const id = sm.createSession("sidebar", mockWebview(), agent);
    const pty = sm.getSession(id)?.pty as unknown as Callbacks;
    const late = { exit: pty._onExitCallback };

    sm.destroySession(id);
    late.exit?.(0);

    expect(spawned).toHaveLength(1);
    sm.dispose();
  });

  it("a handler captured before shutdown is inert after dispose", () => {
    const { sm } = newSM();
    const id = sm.createSession("sidebar", mockWebview(), agent);
    const pty = sm.getSession(id)?.pty as unknown as Callbacks;
    const late = { exit: pty._onExitCallback };

    sm.dispose();
    late.exit?.(0);

    expect(spawned).toHaveLength(1);
  });

  it("recordData builds no mirror for a session that is destroying or disposed", () => {
    const { sm, mirrors } = newSM();
    const id = sm.createSession("sidebar", mockWebview());
    const session = sm.getSession(id)!;
    const snapshots = (sm as unknown as { snapshots: { recordData(s: unknown, d: string): void } }).snapshots;

    for (const state of ["destroying", "disposed"] as const) {
      session.state = state;
      snapshots.recordData(session, "x");
    }
    expect(mirrors).toHaveLength(0);

    session.state = "live";
    snapshots.recordData(session, "x");
    expect(mirrors).toHaveLength(1);
    sm.dispose();
  });
});
