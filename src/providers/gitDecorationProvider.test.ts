// Unit tests for `createGitDecorationProvider`.
//
// We inject a fake `getExtension` factory so the lifecycle cases (absent /
// disabled / uninitialized / activate-throws) can each be exercised
// deterministically without standing up a real extension host.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "../types/messages";
import { createTrackedPathResolver, ResolvedPathMemo } from "../utils/resolvedPathMemo";
import type { API, APIState, GitExtension, Repository } from "./git";
import { Status } from "./git";
import { createGitDecorationProvider } from "./gitDecorationProvider";

type Listener<T> = (value: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    event: (l: Listener<T>) => {
      listeners.add(l);
      return { dispose: () => listeners.delete(l) };
    },
    fire: (v: T) => {
      for (const l of [...listeners]) {
        l(v);
      }
    },
    listenerCount: () => listeners.size,
  };
}

function makeRepo(root: string, changes: Array<{ path: string; status: Status }> = []) {
  const stateEmitter = createEmitter<void>();
  const state = {
    workingTreeChanges: changes.map((c) => ({
      uri: { fsPath: c.path },
      originalUri: { fsPath: c.path },
      renameUri: undefined,
      status: c.status,
    })),
    indexChanges: [] as never[],
    mergeChanges: [] as never[],
    untrackedChanges: [] as never[],
    onDidChange: stateEmitter.event,
  };
  const repo: Repository = {
    rootUri: { fsPath: root } as unknown as Repository["rootUri"],
    state: state as unknown as Repository["state"],
  };
  return {
    repo,
    fire: () => stateEmitter.fire(undefined),
    setChanges: (next: Array<{ path: string; status: Status }>) => {
      (state.workingTreeChanges as unknown[]).length = 0;
      for (const c of next) {
        (
          state.workingTreeChanges as Array<{
            uri: { fsPath: string };
            originalUri: { fsPath: string };
            renameUri: undefined;
            status: Status;
          }>
        ).push({
          uri: { fsPath: c.path },
          originalUri: { fsPath: c.path },
          renameUri: undefined,
          status: c.status,
        });
      }
    },
  };
}

function makeApi(opts: { state?: APIState; repos?: Repository[] } = {}) {
  const repos = opts.repos ?? [];
  const stateEmitter = createEmitter<APIState>();
  const openEmitter = createEmitter<Repository>();
  const closeEmitter = createEmitter<Repository>();
  const api = {
    state: opts.state ?? "initialized",
    onDidChangeState: stateEmitter.event,
    repositories: repos,
    onDidOpenRepository: openEmitter.event,
    onDidCloseRepository: closeEmitter.event,
  } as unknown as API;
  return {
    api,
    setState: (s: APIState) => {
      (api as { state: APIState }).state = s;
      stateEmitter.fire(s);
    },
    openRepo: (r: Repository) => {
      repos.push(r);
      openEmitter.fire(r);
    },
    closeRepo: (r: Repository) => {
      const idx = repos.indexOf(r);
      if (idx >= 0) {
        repos.splice(idx, 1);
      }
      closeEmitter.fire(r);
    },
  };
}

type FakeExtension = {
  activate: () => Promise<GitExtension>;
};

function makeExtension(opts: { enabled?: boolean; api?: API; activateThrows?: boolean } = {}) {
  const enablementEmitter = createEmitter<boolean>();
  const ext: GitExtension = {
    enabled: opts.enabled ?? true,
    onDidChangeEnablement: enablementEmitter.event,
    getAPI: (_v: 1) => {
      if (!opts.api) {
        throw new Error("no API configured for fake");
      }
      return opts.api;
    },
  };
  const activate = vi.fn(async () => {
    if (opts.activateThrows) {
      throw new Error("activate failed");
    }
    return ext;
  });
  const extObj: FakeExtension = { activate };
  return {
    extObj,
    flipEnablement: (v: boolean) => {
      (ext as { enabled: boolean }).enabled = v;
      enablementEmitter.fire(v);
    },
    enablementListenerCount: () => enablementEmitter.listenerCount(),
  };
}

describe("createGitDecorationProvider — lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs once and stays in no-op mode when the extension is absent", () => {
    const onDidChange = vi.fn(() => ({ dispose: () => {} }));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const provider = createGitDecorationProvider({
      getExtension: () => undefined,
      onDidChangeExtensions: onDidChange as never,
      logger,
    });
    expect(provider.getApi?.()).toBeUndefined();
    expect(provider.getStatus("/x").status).toBeUndefined();
    expect(provider.getStatus("/x").revision).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("not found"));
    // Retry subscription installed once.
    expect(onDidChange).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("activates the extension and registers existing repos on creation", async () => {
    const { repo } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
    });
    // Allow the awaited activate() chain to settle.
    await new Promise((r) => setImmediate(r));
    expect(provider.getApi?.()).toBe(api);
    expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");
    provider.dispose();
    expect(provider.getApi?.()).toBeUndefined();
  });

  it("waits for enablement to flip before binding the API", async () => {
    const { repo } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [repo] });
    const { extObj, flipEnablement } = makeExtension({ enabled: false, api });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      logger,
    });
    await new Promise((r) => setImmediate(r));
    // Still no status — we never bound the API.
    expect(provider.getStatus("/repo/a.ts").status).toBeUndefined();
    flipEnablement(true);
    await new Promise((r) => setImmediate(r));
    expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");
    provider.dispose();
  });

  it("does not install duplicate enablement waiters across extension-change retries", async () => {
    const { repo } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [repo] });
    const fake = makeExtension({ enabled: false, api });
    const extensionChanges = createEmitter<void>();
    let currentExtension: FakeExtension | undefined;
    const provider = createGitDecorationProvider({
      getExtension: () => currentExtension as never,
      onDidChangeExtensions: extensionChanges.event as never,
    });

    currentExtension = fake.extObj;
    extensionChanges.fire(undefined);
    await new Promise((r) => setImmediate(r));
    expect(fake.enablementListenerCount()).toBe(1);
    expect(fake.extObj.activate).toHaveBeenCalledTimes(1);

    extensionChanges.fire(undefined);
    await new Promise((r) => setImmediate(r));
    expect(fake.enablementListenerCount()).toBe(1);
    expect(fake.extObj.activate).toHaveBeenCalledTimes(1);

    fake.flipEnablement(true);
    await new Promise((r) => setImmediate(r));
    expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");
    provider.dispose();
  });

  it("waits for api.state=initialized before registering repos", async () => {
    const { repo } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
    const { api, setState } = makeApi({ state: "uninitialized", repos: [repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
    });
    await new Promise((r) => setImmediate(r));
    expect(provider.getStatus("/repo/a.ts").status).toBeUndefined();
    setState("initialized");
    await new Promise((r) => setImmediate(r));
    expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");
    provider.dispose();
  });

  it("disables permanently when activate() throws", async () => {
    const { extObj } = makeExtension({ activateThrows: true });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      logger,
    });
    await new Promise((r) => setImmediate(r));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(provider.getStatus("/x").status).toBeUndefined();
    provider.dispose();
  });
});

describe("createGitDecorationProvider — emission semantics", () => {
  // These tests use real timers to assert wall-clock 100 ms debounce behaviour.
  // The block below covering coalescing uses fake timers explicitly.

  it("coalesces three back-to-back rebuilds within 100 ms into one emission", async () => {
    vi.useFakeTimers();
    try {
      const { repo, fire, setChanges } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      // The activate() promise needs a microtask flush before repos register.
      await vi.runAllTimersAsync();

      const deltas: Array<{ revision: number; changes: readonly { path: string; status: GitStatus | null }[] }> = [];
      provider.onDidChange((d) => deltas.push({ revision: d.revision, changes: [...d.changes] }));

      // Burst three rebuilds; only the last status per path should survive.
      setChanges([{ path: "/repo/a.ts", status: Status.INDEX_ADDED }]);
      fire();
      vi.advanceTimersByTime(30);
      setChanges([{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      fire();
      vi.advanceTimersByTime(30);
      setChanges([{ path: "/repo/a.ts", status: Status.UNTRACKED }]);
      fire();
      expect(deltas).toHaveLength(0);

      vi.advanceTimersByTime(100); // flush after the third schedule
      expect(deltas).toHaveLength(1);
      expect(deltas[0].changes).toEqual([{ path: "/repo/a.ts", status: "untracked" }]);

      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits monotonically-increasing revisions across separate batches", async () => {
    vi.useFakeTimers();
    try {
      const { repo, fire, setChanges } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();

      const revs: number[] = [];
      provider.onDidChange((d) => revs.push(d.revision));

      setChanges([{ path: "/repo/a.ts", status: Status.INDEX_ADDED }]);
      fire();
      vi.advanceTimersByTime(100);

      setChanges([]);
      fire();
      vi.advanceTimersByTime(100);

      expect(revs).toHaveLength(2);
      expect(revs[0]).toBeLessThan(revs[1]);

      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("getStatus reflects the latest revision after a flush", async () => {
    vi.useFakeTimers();
    try {
      const { repo, fire, setChanges } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // flush the initial-repo emission
      const first = provider.getStatus("/repo/a.ts").revision;
      setChanges([{ path: "/repo/a.ts", status: Status.INDEX_ADDED }]);
      fire();
      vi.advanceTimersByTime(100);
      const second = provider.getStatus("/repo/a.ts").revision;
      expect(second).toBeGreaterThan(first);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("getStatus flushes pending coalesced changes before returning a status/revision pair", async () => {
    vi.useFakeTimers();
    try {
      const { repo, fire, setChanges } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      const first = provider.getStatus("/repo/a.ts").revision;
      const deltas: number[] = [];
      provider.onDidChange((d) => deltas.push(d.revision));

      setChanges([{ path: "/repo/a.ts", status: Status.INDEX_ADDED }]);
      fire();
      const sampled = provider.getStatus("/repo/a.ts");

      expect(sampled.status).toBe<GitStatus>("added");
      expect(sampled.revision).toBeGreaterThan(first);
      expect(deltas).toEqual([sampled.revision]);
      vi.advanceTimersByTime(100);
      expect(deltas).toEqual([sampled.revision]);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — multi-root containment (D12)", () => {
  it("closing /repo does NOT clear entries under /repo-foo (prefix collision)", async () => {
    vi.useFakeTimers();
    try {
      const { repo: repoA } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { repo: repoB } = makeRepo("/repo-foo", [{ path: "/repo-foo/b.ts", status: Status.MODIFIED }]);
      const { api, closeRepo } = makeApi({ repos: [repoA, repoB] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);

      expect(provider.getStatus("/repo/a.ts").status).toBe("modified");
      expect(provider.getStatus("/repo-foo/b.ts").status).toBe("modified");

      // Close /repo only — /repo-foo MUST survive.
      closeRepo(repoA);
      vi.advanceTimersByTime(100);
      expect(provider.getStatus("/repo/a.ts").status).toBeUndefined();
      expect(provider.getStatus("/repo-foo/b.ts").status).toBe("modified");

      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — reset (O-B1)", () => {
  it("clears all per-repo maps then rebuilds from api.repositories", async () => {
    vi.useFakeTimers();
    try {
      const { repo: repoA } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { repo: repoB } = makeRepo("/repo-foo", [{ path: "/repo-foo/b.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repoA, repoB] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // flush initial rebuild emissions

      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));

      provider.reset();
      vi.advanceTimersByTime(100);

      // Two bursts: (1) clears for the prior state, (2) rebuilt deltas for
      // current state. Both go through the same listener.
      const flat = deltas.flat();
      const cleared = flat.filter((c) => c.status === null).map((c) => c.path);
      const rebuilt = flat.filter((c) => c.status !== null).map((c) => c.path);
      expect(cleared.sort()).toEqual(["/repo-foo/b.ts", "/repo/a.ts"]);
      expect(rebuilt.sort()).toEqual(["/repo-foo/b.ts", "/repo/a.ts"]);

      // O-B1: After reset, subsequent snapshot stamping still returns the
      // current state — the previous behavior left this undefined until the
      // next git event fired.
      expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");
      expect(provider.getStatus("/repo-foo/b.ts").status).toBe<GitStatus>("modified");
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — dispose", () => {
  it("is idempotent and stops emitting after dispose", async () => {
    vi.useFakeTimers();
    try {
      const { repo, fire, setChanges } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);

      const seen: number[] = [];
      provider.onDidChange((d) => seen.push(d.revision));
      provider.dispose();
      provider.dispose(); // second call is a no-op

      setChanges([{ path: "/repo/a.ts", status: Status.INDEX_ADDED }]);
      fire();
      vi.advanceTimersByTime(100);
      expect(seen).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — workspace-folder filter (round-1 W1)", () => {
  it("drops emitted paths that fall outside any configured workspace folder", async () => {
    vi.useFakeTimers();
    try {
      const inside = "/work/repo/a.ts";
      const outside = "/elsewhere/auto-detected-repo/b.ts";
      const r = makeRepo("/work/repo", [
        { path: inside, status: Status.MODIFIED },
        { path: outside, status: Status.MODIFIED },
      ]);
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => ["/work/repo"],
      });
      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      const allPaths = deltas.flat().map((c) => c.path);
      expect(allPaths).toContain(inside);
      expect(allPaths).not.toContain(outside);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT match path-prefix collisions (e.g. /work/repo vs /work/repo-foo)", async () => {
    vi.useFakeTimers();
    try {
      const sibling = "/work/repo-foo/x.ts";
      const r = makeRepo("/work/repo", [{ path: sibling, status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => ["/work/repo"],
      });
      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      const allPaths = deltas.flat().map((c) => c.path);
      expect(allPaths).not.toContain(sibling);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets all paths through when no workspace folder is configured", async () => {
    vi.useFakeTimers();
    try {
      const anywhere = "/somewhere/foo.ts";
      const r = makeRepo("/somewhere", [{ path: anywhere, status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => [],
      });
      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      const allPaths = deltas.flat().map((c) => c.path);
      expect(allPaths).toContain(anywhere);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — workspace-folder containment edge cases (O-M1)", () => {
  // Each scenario builds a fresh provider with the edge-case root, fires
  // emission, and checks whether `inside` reaches the listener. We rely on
  // the filter being the gate between repo state and emitted deltas.
  async function probe(root: string, paths: string[]): Promise<string[]> {
    vi.useFakeTimers();
    try {
      const r = makeRepo(
        "/anywhere",
        paths.map((p) => ({ path: p, status: Status.MODIFIED })),
      );
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => [root],
      });
      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      const got = deltas.flat().map((c) => c.path);
      provider.dispose();
      return got;
    } finally {
      vi.useRealTimers();
    }
  }

  it("POSIX filesystem root `/` lets every absolute path through", async () => {
    const got = await probe("/", ["/foo/a.ts", "/bar/b.ts"]);
    expect(got).toContain("/foo/a.ts");
    expect(got).toContain("/bar/b.ts");
  });

  it("Windows filesystem root `C:\\` matches paths on the same drive", async () => {
    const got = await probe("C:\\", ["C:\\proj\\a.ts", "C:\\b.ts"]);
    expect(got).toContain("C:\\proj\\a.ts");
    expect(got).toContain("C:\\b.ts");
  });

  it("Windows root with different drive letter casing still matches", async () => {
    const got = await probe("c:\\work", ["C:\\work\\a.ts"]);
    expect(got).toContain("C:\\work\\a.ts");
  });

  it("Windows root with mixed separators matches forward-slash paths", async () => {
    // Root uses backslashes, path uses forward slashes (e.g. from a
    // forward-slashed URI). Normalize should fold them into the same form.
    const got = await probe("C:\\work", ["C:/work/a.ts"]);
    expect(got).toContain("C:/work/a.ts");
  });

  it("Windows root with trailing separator still rejects sibling-prefix matches", async () => {
    const got = await probe("C:\\work\\repo", ["C:\\work\\repo-foo\\x.ts"]);
    expect(got).not.toContain("C:\\work\\repo-foo\\x.ts");
  });
});

describe("createGitDecorationProvider — internal workspace-folder reset (O-W3)", () => {
  it("subscribes to workspace folder changes and runs reset+rebuild", async () => {
    vi.useFakeTimers();
    try {
      const { repo } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const { extObj } = makeExtension({ api });
      const wsfEmitter = createEmitter<unknown>();
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        onDidChangeWorkspaceFolders: wsfEmitter.event as never,
      });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100); // initial rebuild

      const seen: Array<{ revision: number; changes: Array<{ path: string; status: GitStatus | null }> }> = [];
      provider.onDidChange((d) => seen.push({ revision: d.revision, changes: [...d.changes] }));

      wsfEmitter.fire(undefined);
      vi.advanceTimersByTime(100);

      // After folder change: clears + rebuild — same flow as a direct reset().
      const cleared = seen.flatMap((d) => d.changes).filter((c) => c.status === null);
      const rebuilt = seen.flatMap((d) => d.changes).filter((c) => c.status !== null);
      expect(cleared.map((c) => c.path)).toContain("/repo/a.ts");
      expect(rebuilt.map((c) => c.path)).toContain("/repo/a.ts");
      expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");

      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives provider acquisition lifecycle (subscription not disposed by bindApi)", async () => {
    vi.useFakeTimers();
    try {
      // Force the activation path through the "absent → onDidChange retry"
      // arm so that `bindApi` runs after at least one round of
      // `disposeLifecycleSubs`. The workspace-folder sub must survive that.
      const { repo } = makeRepo("/repo", [{ path: "/repo/a.ts", status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [repo] });
      const fake = makeExtension({ api });
      const extensionChanges = createEmitter<void>();
      let currentExtension: FakeExtension | undefined;
      const wsfEmitter = createEmitter<unknown>();
      const provider = createGitDecorationProvider({
        getExtension: () => currentExtension as never,
        onDidChangeExtensions: extensionChanges.event as never,
        onDidChangeWorkspaceFolders: wsfEmitter.event as never,
      });
      currentExtension = fake.extObj;
      extensionChanges.fire(undefined);
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");

      // Folder change AFTER bindApi must still trigger the internal reset.
      wsfEmitter.fire(undefined);
      vi.advanceTimersByTime(100);
      // Still observable through getStatus (which itself flushes pending).
      expect(provider.getStatus("/repo/a.ts").status).toBe<GitStatus>("modified");
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — detachRepo redundant emissions (O-L1)", () => {
  it("does NOT emit when the closing repo's contribution was lower-severity than the survivor", async () => {
    vi.useFakeTimers();
    try {
      const sharedPath = "/work/shared.ts";
      // Repo A claims the path as `untracked`, repo B as `modified` (higher).
      // Merged-before-close = modified; closing A leaves merged = modified.
      // No delta should fire for shared.ts.
      const { repo: repoA } = makeRepo("/work/repoA", [{ path: sharedPath, status: Status.UNTRACKED }]);
      const { repo: repoB } = makeRepo("/work/repoB", [{ path: sharedPath, status: Status.MODIFIED }]);
      const { api, closeRepo } = makeApi({ repos: [repoA, repoB] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);

      const post: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => post.push([...d.changes]));

      closeRepo(repoA);
      vi.advanceTimersByTime(100);

      const allPaths = post.flat().map((c) => c.path);
      expect(allPaths).not.toContain(sharedPath);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("DOES emit when the closing repo's contribution was higher-severity", async () => {
    vi.useFakeTimers();
    try {
      const sharedPath = "/work/shared.ts";
      // Repo A claims `modified` (higher), repo B `untracked`. Closing A
      // should drop merged to `untracked`.
      const { repo: repoA } = makeRepo("/work/repoA", [{ path: sharedPath, status: Status.MODIFIED }]);
      const { repo: repoB } = makeRepo("/work/repoB", [{ path: sharedPath, status: Status.UNTRACKED }]);
      const { api, closeRepo } = makeApi({ repos: [repoA, repoB] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({ getExtension: () => extObj as never });
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);

      const post: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => post.push([...d.changes]));

      closeRepo(repoA);
      vi.advanceTimersByTime(100);

      const closingEntry = post.flat().find((c) => c.path === sharedPath);
      expect(closingEntry).toBeDefined();
      expect(closingEntry?.status).toBe<GitStatus>("untracked");
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGitDecorationProvider — a workspace folder reached through a symlink", () => {
  // Over a real `ResolvedPathMemo` with a counted `realpath`, because half of
  // this task's acceptance is a COST claim — "no `realpath` per decorated
  // file" — which no type-check and no attribution assertion can see.
  function symlinked(links: Record<string, string>) {
    const realpaths: string[] = [];
    const memo = new ResolvedPathMemo({
      realpath: async (p) => {
        realpaths.push(p);
        const hit = links[p];
        if (hit === undefined) {
          throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
        }
        return hit;
      },
    });
    return { paths: createTrackedPathResolver(memo), realpaths };
  }

  it("still scopes decorations when the folder is spelled through a link", async () => {
    vi.useFakeTimers();
    try {
      // The repository reports physical paths; the workspace folder is the
      // link. Lexically nothing is inside it, so every decoration was dropped.
      const inside = "/private/work/repo/a.ts";
      const outside = "/elsewhere/b.ts";
      const r = makeRepo("/private/work/repo", [
        { path: inside, status: Status.MODIFIED },
        { path: outside, status: Status.MODIFIED },
      ]);
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const { paths } = symlinked({ "/link/repo": "/private/work/repo" });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => ["/link/repo"],
        paths,
      });
      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      const allPaths = deltas.flat().map((c) => c.path);
      expect(allPaths).toContain(inside);
      expect(allPaths).not.toContain(outside);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues no realpath per decorated file, however many are decorated", async () => {
    vi.useFakeTimers();
    try {
      const changes = Array.from({ length: 40 }, (_, i) => ({
        path: `/private/work/repo/f${i}.ts`,
        status: Status.MODIFIED,
      }));
      const r = makeRepo("/private/work/repo", changes);
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const { paths, realpaths } = symlinked({ "/link/repo": "/private/work/repo" });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => ["/link/repo"],
        paths,
      });
      provider.onDidChange(() => {});
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);

      // One folder, one syscall — not one per file, and not one per refresh.
      expect(realpaths).toEqual(["/link/repo"]);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-resolves after a workspace folder is replaced", async () => {
    const emitter = createEmitter<void>();
    const links: Record<string, string> = { "/link/repo": "/private/one" };
    const { paths, realpaths } = symlinked(links);
    let folders = ["/link/repo"];
    const { api } = makeApi({ repos: [] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => folders,
      onDidChangeWorkspaceFolders: emitter.event,
      paths,
    });
    await Promise.resolve();
    await Promise.resolve();

    folders = [];
    emitter.fire();
    await Promise.resolve();
    links["/link/repo"] = "/private/two";
    folders = ["/link/repo"];
    emitter.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(realpaths).toEqual(["/link/repo", "/link/repo"]);
    provider.dispose();
  });

  it("rebuilds once per workspace-folder change, not twice", async () => {
    // Round-2 W2. The handler reset immediately AND the resolution reset again
    // when it landed, so one cold event scanned every decorated path and
    // rebuilt every repository twice.
    const emitter = createEmitter<void>();
    const { paths } = symlinked({ "/link/repo": "/private/work/repo" });
    const r = makeRepo("/private/work/repo", [{ path: "/private/work/repo/a.ts", status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [r.repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => ["/link/repo"],
      onDidChangeWorkspaceFolders: emitter.event,
      paths,
    });
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }
    const clears: number[] = [];
    provider.onDidChange((d) => {
      const cleared = d.changes.filter((c) => c.status === null).length;
      if (cleared > 0) {
        clears.push(cleared);
      }
    });

    emitter.fire();
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }

    expect(clears).toHaveLength(1);
    provider.dispose();
  });

  it("rebuilds once the folder resolution lands, so the first pass is not the final answer", async () => {
    // Round-1 B2. `prepare` is fire-and-forget so the comparison can stay sync;
    // without a rebuild behind it the lexical fallback was permanent and a
    // symlink-spelled folder stayed undecorated until some unrelated Git event.
    let release: (real: string) => void = () => {};
    const memo = new ResolvedPathMemo({
      realpath: () => new Promise<string>((resolve) => (release = resolve)),
    });
    const inside = "/private/work/repo/a.ts";
    const r = makeRepo("/private/work/repo", [{ path: inside, status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [r.repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => ["/link/repo"],
      paths: createTrackedPathResolver(memo),
    });
    const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
    provider.onDidChange((d) => deltas.push([...d.changes]));
    await new Promise((r2) => setTimeout(r2, 0));

    // Nothing is decorated yet: the folder is still only a spelling.
    expect(deltas.flat().map((c) => c.path)).not.toContain(inside);

    release("/private/work/repo");
    await new Promise((r2) => setTimeout(r2, 0));
    await new Promise((r2) => setTimeout(r2, 0));

    expect(deltas.flat().map((c) => c.path)).toContain(inside);
    provider.dispose();
  });

  it("treats the decorated path as a spelling even when the memo knows that spelling", async () => {
    // Round-1 S1: the memo is SHARED, so a decorated path can already be
    // prepared as some other producer's folder or root. The per-event candidate
    // must still be compared lexically — D1 draws the line at who produced the
    // path, not at whether an answer happens to be lying around.
    const memo = new ResolvedPathMemo({
      realpath: async (p) => (p === "/link/repo" ? "/private/work/repo" : "/somewhere/else"),
    });
    // Prepare the decorated file's own spelling, as another producer would.
    await createTrackedPathResolver(memo).prepare(["/private/work/repo/a.ts"]);

    const inside = "/private/work/repo/a.ts";
    const r = makeRepo("/private/work/repo", [{ path: inside, status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [r.repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => ["/link/repo"],
      paths: createTrackedPathResolver(memo),
    });
    const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
    provider.onDidChange((d) => deltas.push([...d.changes]));
    for (let i = 0; i < 6; i++) {
      await new Promise((r2) => setTimeout(r2, 0));
    }

    // Resolving the candidate would send it to /somewhere/else and drop it.
    expect(deltas.flat().map((c) => c.path)).toContain(inside);
    provider.dispose();
  });

  it("decorates exactly as before when no resolver is supplied", async () => {
    vi.useFakeTimers();
    try {
      const inside = "/work/repo/a.ts";
      const r = makeRepo("/work/repo", [{ path: inside, status: Status.MODIFIED }]);
      const { api } = makeApi({ repos: [r.repo] });
      const { extObj } = makeExtension({ api });
      const provider = createGitDecorationProvider({
        getExtension: () => extObj as never,
        getWorkspaceFolders: () => ["/work/repo"],
      });
      const deltas: Array<{ path: string; status: GitStatus | null }[]> = [];
      provider.onDidChange((d) => deltas.push([...d.changes]));
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(100);
      expect(deltas.flat().map((c) => c.path)).toContain(inside);
      provider.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

// A folder path may reach `getDescendantBuckets` spelled with or without its
// trailing separator — the scan this lookup replaced accepted both, and a
// filesystem root can only be spelled WITH one. See the `bucketKey` note in
// gitDecorationProvider.ts.
describe("createGitDecorationProvider — getDescendantBuckets path spellings", () => {
  async function withRepo(root: string, files: Array<{ path: string; status: Status }>) {
    const { repo } = makeRepo(root, files);
    const { api } = makeApi({ repos: [repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => [],
    });
    await new Promise((r) => setImmediate(r));
    return provider;
  }

  it("answers a POSIX folder the same with and without a trailing separator", async () => {
    const provider = await withRepo("/work/repo", [
      { path: "/work/repo/src/a.ts", status: Status.MODIFIED },
      { path: "/work/repo/src/deep/b.ts", status: Status.UNTRACKED },
    ]);
    const bare = provider.getDescendantBuckets("/work/repo/src");
    expect(bare).toEqual({ modified: 1, untracked: 1 });
    expect(provider.getDescendantBuckets("/work/repo/src/")).toEqual(bare);
    expect(provider.getDescendantBuckets("/work/repo/")).toEqual(bare);
    provider.dispose();
  });

  it("answers the POSIX filesystem root, whose only spelling carries the separator", async () => {
    const provider = await withRepo("/work/repo", [{ path: "/work/repo/a.ts", status: Status.MODIFIED }]);
    expect(provider.getDescendantBuckets("/")).toEqual({ modified: 1 });
    // `//` is a boundary no real path starts with — the scan returned nothing for
    // it, so stripping must not turn it into the root.
    expect(provider.getDescendantBuckets("//")).toBeUndefined();
    provider.dispose();
  });

  it("answers a Windows folder across separator and case spellings", async () => {
    const provider = await withRepo("C:\\work\\repo", [
      { path: "C:\\work\\repo\\src\\a.ts", status: Status.MODIFIED },
      { path: "C:\\work\\repo\\src\\b.ts", status: Status.INDEX_ADDED },
    ]);
    const bare = provider.getDescendantBuckets("C:\\work\\repo\\src");
    expect(bare).toEqual({ modified: 1, added: 1 });
    expect(provider.getDescendantBuckets("C:\\work\\repo\\src\\")).toEqual(bare);
    expect(provider.getDescendantBuckets("c:/work/repo/src/")).toEqual(bare);
    // The drive root keeps its separator — stripping it would miss the bucket.
    expect(provider.getDescendantBuckets("C:\\")).toEqual(bare);
    expect(provider.getDescendantBuckets("C:\\\\")).toBeUndefined();
    provider.dispose();
  });

  it("still returns undefined for a folder with no dirty descendants", async () => {
    const provider = await withRepo("/work/repo", [{ path: "/work/repo/a.ts", status: Status.MODIFIED }]);
    expect(provider.getDescendantBuckets("/work/other")).toBeUndefined();
    expect(provider.getDescendantBuckets("/work/other/")).toBeUndefined();
    provider.dispose();
  });
});

// The descendant index is maintained on the mutation side, so every path that
// mutates the merged status must keep the ancestor counts in step. Each case
// here asserts `getDescendantBuckets` AFTER a mutation; the spelling cases
// above only ever read a freshly attached repo (review F002).
describe("createGitDecorationProvider — getDescendantBuckets across mutations", () => {
  async function setup(
    repos: Array<{ root: string; files: Array<{ path: string; status: Status }> }>,
    folders: () => string[] = () => [],
  ) {
    const made = repos.map((r) => makeRepo(r.root, r.files));
    const apiBits = makeApi({ repos: made.map((m) => m.repo) });
    const { extObj } = makeExtension({ api: apiBits.api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: folders,
    });
    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(100);
    return { provider, made, ...apiBits };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a path between buckets when its propagating status changes", async () => {
    vi.useFakeTimers();
    const { provider, made } = await setup([
      { root: "/w/repo", files: [{ path: "/w/repo/src/a.ts", status: Status.UNTRACKED }] },
    ]);
    expect(provider.getDescendantBuckets("/w/repo/src")).toEqual({ untracked: 1 });
    made[0].setChanges([{ path: "/w/repo/src/a.ts", status: Status.MODIFIED }]);
    made[0].fire();
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w/repo/src")).toEqual({ modified: 1 });
    expect(provider.getDescendantBuckets("/w/repo")).toEqual({ modified: 1 });
    expect(provider.getDescendantBuckets("/w")).toEqual({ modified: 1 });
    provider.dispose();
  });

  it("drops a path from every ancestor when it goes clean, deleted or ignored", async () => {
    vi.useFakeTimers();
    const { provider, made } = await setup([
      {
        root: "/w/repo",
        files: [
          { path: "/w/repo/src/a.ts", status: Status.MODIFIED },
          { path: "/w/repo/src/b.ts", status: Status.MODIFIED },
          { path: "/w/repo/src/c.ts", status: Status.MODIFIED },
          { path: "/w/repo/keep.ts", status: Status.INDEX_ADDED },
        ],
      },
    ]);
    expect(provider.getDescendantBuckets("/w/repo/src")).toEqual({ modified: 3 });
    made[0].setChanges([
      { path: "/w/repo/src/b.ts", status: Status.DELETED },
      { path: "/w/repo/src/c.ts", status: Status.IGNORED },
      { path: "/w/repo/keep.ts", status: Status.INDEX_ADDED },
    ]);
    made[0].fire();
    vi.advanceTimersByTime(100);
    // `deleted`/`ignored` do not propagate (D6) and a.ts is clean: src is empty.
    expect(provider.getDescendantBuckets("/w/repo/src")).toBeUndefined();
    expect(provider.getDescendantBuckets("/w/repo")).toEqual({ added: 1 });
    provider.dispose();
  });

  it("recounts an overlapping path under the surviving severity when the winner changes", async () => {
    vi.useFakeTimers();
    const shared = "/w/shared/x.ts";
    const { provider, made } = await setup([
      { root: "/w/a", files: [{ path: shared, status: Status.MODIFIED }] },
      { root: "/w/b", files: [{ path: shared, status: Status.UNTRACKED }] },
    ]);
    // One path, counted once under the higher severity.
    expect(provider.getDescendantBuckets("/w/shared")).toEqual({ modified: 1 });
    made[0].setChanges([{ path: shared, status: Status.INDEX_ADDED }]);
    made[0].fire();
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w/shared")).toEqual({ added: 1 });
    made[0].setChanges([]);
    made[0].fire();
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w/shared")).toEqual({ untracked: 1 });
    provider.dispose();
  });

  it("removes a closing repo's contribution and restores it on reopen", async () => {
    vi.useFakeTimers();
    const shared = "/w/shared/x.ts";
    const { provider, made, closeRepo, openRepo } = await setup([
      {
        root: "/w/a",
        files: [
          { path: shared, status: Status.MODIFIED },
          { path: "/w/a/only.ts", status: Status.MODIFIED },
        ],
      },
      { root: "/w/b", files: [{ path: shared, status: Status.UNTRACKED }] },
    ]);
    expect(provider.getDescendantBuckets("/w")).toEqual({ modified: 2 });
    closeRepo(made[0].repo);
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w/a")).toBeUndefined();
    expect(provider.getDescendantBuckets("/w/shared")).toEqual({ untracked: 1 });
    expect(provider.getDescendantBuckets("/w")).toEqual({ untracked: 1 });
    openRepo(made[0].repo);
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w/a")).toEqual({ modified: 1 });
    expect(provider.getDescendantBuckets("/w")).toEqual({ modified: 2 });
    provider.dispose();
  });

  it("rebuilds the index from scratch on reset without double counting", async () => {
    vi.useFakeTimers();
    const { provider } = await setup([
      { root: "/w/repo", files: [{ path: "/w/repo/src/a.ts", status: Status.MODIFIED }] },
      { root: "/w/other", files: [{ path: "/w/other/b.ts", status: Status.UNTRACKED }] },
    ]);
    const before = provider.getDescendantBuckets("/w");
    expect(before).toEqual({ modified: 1, untracked: 1 });
    provider.reset();
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w")).toEqual(before);
    expect(provider.getDescendantBuckets("/w/repo/src")).toEqual({ modified: 1 });
    provider.dispose();
  });

  it("counts a nested repository's paths under the outer repository's folders", async () => {
    vi.useFakeTimers();
    const { provider, made } = await setup([
      { root: "/w/outer", files: [{ path: "/w/outer/a.ts", status: Status.MODIFIED }] },
      { root: "/w/outer/inner", files: [{ path: "/w/outer/inner/b.ts", status: Status.UNTRACKED }] },
    ]);
    expect(provider.getDescendantBuckets("/w/outer")).toEqual({ modified: 1, untracked: 1 });
    expect(provider.getDescendantBuckets("/w/outer/inner")).toEqual({ untracked: 1 });
    made[1].setChanges([]);
    made[1].fire();
    vi.advanceTimersByTime(100);
    expect(provider.getDescendantBuckets("/w/outer")).toEqual({ modified: 1 });
    expect(provider.getDescendantBuckets("/w/outer/inner")).toBeUndefined();
    provider.dispose();
  });
});

// A path's revision watermark must go when the path goes clean — even when the
// clean delta never reaches the webview because the path's workspace folder is
// gone. Observed through `getStatus`: an evicted path is stamped with the
// CURRENT global revision, a retained one with its stale watermark (review F001).
describe("createGitDecorationProvider — revision eviction under workspace filtering", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts a path that goes clean after its workspace folder was removed", async () => {
    vi.useFakeTimers();
    let folders = ["/w/one", "/w/two"];
    const one = makeRepo("/w/one", [{ path: "/w/one/a.ts", status: Status.MODIFIED }]);
    const two = makeRepo("/w/two", [{ path: "/w/two/b.ts", status: Status.MODIFIED }]);
    const { api } = makeApi({ repos: [one.repo, two.repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => folders,
    });
    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(100);
    const stale = provider.getStatus("/w/one/a.ts").revision;

    // The folder goes away without a reset; a.ts then goes clean. Its null
    // delta is filtered out and never flushed.
    folders = ["/w/two"];
    one.setChanges([]);
    one.fire();
    vi.advanceTimersByTime(100);
    // Bump the global revision with an in-scope change.
    two.setChanges([{ path: "/w/two/b.ts", status: Status.INDEX_ADDED }]);
    two.fire();
    vi.advanceTimersByTime(100);

    const now = provider.currentRevision();
    expect(now).toBeGreaterThan(stale);
    expect(provider.getStatus("/w/one/a.ts")).toEqual({ status: undefined, revision: now });
    provider.dispose();
  });

  it("evicts every path on reset, including ones the new folder set filters out", async () => {
    vi.useFakeTimers();
    let folders = ["/w/one", "/w/two"];
    const one = makeRepo("/w/one", [{ path: "/w/one/a.ts", status: Status.MODIFIED }]);
    const two = makeRepo("/w/two", [{ path: "/w/two/b.ts", status: Status.MODIFIED }]);
    const { api, closeRepo } = makeApi({ repos: [one.repo, two.repo] });
    const { extObj } = makeExtension({ api });
    const provider = createGitDecorationProvider({
      getExtension: () => extObj as never,
      getWorkspaceFolders: () => folders,
    });
    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(100);
    const stale = provider.getStatus("/w/one/a.ts").revision;

    folders = ["/w/two"];
    closeRepo(one.repo);
    provider.reset();
    vi.advanceTimersByTime(100);
    two.setChanges([{ path: "/w/two/b.ts", status: Status.INDEX_ADDED }]);
    two.fire();
    vi.advanceTimersByTime(100);

    const now = provider.currentRevision();
    expect(now).toBeGreaterThan(stale);
    expect(provider.getStatus("/w/one/a.ts")).toEqual({ status: undefined, revision: now });
    provider.dispose();
  });
});
