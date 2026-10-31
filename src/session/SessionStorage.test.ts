import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import {
  LIVE_EDITOR_PANELS_KEY,
  type LiveEditorPanelsRecord,
  SESSION_SNAPSHOTS_INDEX_KEY,
  type SessionSnapshotMetadata,
  type SessionSnapshotsIndex,
} from "./SessionSnapshot";
import { SessionStorage, type SessionStorageFs } from "./SessionStorage";

function makeFakeMemento(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (key: string) => store.get(key),
    update: vi.fn((key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return Promise.resolve();
    }),
    _snapshot: () => Object.fromEntries(store),
  };
}

function makeFakeFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  // A file's identity, as an inode: minted per write, carried by a rename.
  const inodes = new Map<string, number>();
  let nextInode = 1;
  const minted = (f: string): void => {
    inodes.set(f, nextInode++);
  };
  const moved = (from: string, to: string): void => {
    const ino = inodes.get(from);
    inodes.delete(from);
    if (ino !== undefined) {
      inodes.set(to, ino);
    }
  };
  const writeFileSync = vi.fn((f: string, d: string, _opts?: { mode?: number }) => {
    files.set(f, d);
    minted(f);
  });
  const writeFile = vi.fn(async (f: string, d: string, _opts?: { mode?: number }) => {
    files.set(f, d);
    minted(f);
  });
  const fs: SessionStorageFs = {
    writeFileSync,
    readFileSync: (f) => {
      const v = files.get(f);
      if (v === undefined) {
        throw new Error(`ENOENT: ${f}`);
      }
      return v;
    },
    mkdirSync: vi.fn((d, _opts) => {
      dirs.add(d);
    }),
    existsSync: (f: string) => files.has(f) || dirs.has(f),
    unlinkSync: vi.fn((f: string) => {
      files.delete(f);
      inodes.delete(f);
    }),
    readdirSync: (d: string) => {
      const prefix = d.endsWith("/") ? d : `${d}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((name) => !name.includes("/"));
    },
    rmSync: vi.fn((d: string, _opts) => {
      dirs.delete(d);
      for (const k of [...files.keys()]) {
        if (k.startsWith(d.endsWith("/") ? d : `${d}/`)) {
          files.delete(k);
        }
      }
    }),
    renameSync: vi.fn((from: string, to: string) => {
      const v = files.get(from);
      if (v === undefined) {
        throw new Error(`ENOENT: ${from}`);
      }
      files.set(to, v);
      files.delete(from);
      moved(from, to);
    }),
    promises: {
      writeFile,
      readFile: async (f) => {
        const v = files.get(f);
        if (v === undefined) {
          throw new Error(`ENOENT: ${f}`);
        }
        return v;
      },
      mkdir: vi.fn(async (d, _opts) => {
        dirs.add(d);
        return undefined;
      }),
      unlink: vi.fn(async (f) => {
        files.delete(f);
        inodes.delete(f);
      }),
      rename: vi.fn(async (from: string, to: string) => {
        const v = files.get(from);
        if (v === undefined) {
          throw new Error(`ENOENT: ${from}`);
        }
        files.set(to, v);
        files.delete(from);
        moved(from, to);
      }),
      stat: async (f: string) => {
        const ino = inodes.get(f);
        if (ino === undefined || !files.has(f)) {
          throw Object.assign(new Error(`ENOENT: ${f}`), { code: "ENOENT" });
        }
        return { dev: 1, ino };
      },
    },
  };
  return { fs, files, dirs, writeFileSync, writeFile };
}

const STORAGE_URI = { fsPath: "/tmp/atstorage" } as unknown as vscode.Uri;
const SNAPS_DIR = "/tmp/atstorage/snapshots";

function bufferFile(sessionId: string) {
  return `${SNAPS_DIR}/${sessionId}.snapshot.ans`;
}

function makeMeta(sessionId: string, overrides: Partial<SessionSnapshotMetadata> = {}): SessionSnapshotMetadata {
  return {
    sessionId,
    viewLocation: "sidebar",
    terminalNumber: 1,
    customName: null,
    shell: "/bin/zsh",
    shellArgs: [],
    cwd: "/home/user",
    currentCwd: null,
    cols: 80,
    rows: 24,
    bufferFile: `snapshots/${sessionId}.snapshot.ans`,
    bufferBytes: 0,
    isSplitPane: false,
    rootTabId: sessionId,
    snapshotAt: 1700000000000,
    shellExited: false,
    exitCode: null,
    ...overrides,
  };
}

describe("SessionStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips snapshot index via sidecar; live-panels via workspaceState (D17)", async () => {
    const mem = makeFakeMemento();
    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);

    const index: SessionSnapshotsIndex = { version: 1, entries: { s1: makeMeta("s1") } };
    const live: LiveEditorPanelsRecord = {
      version: 1,
      panels: [{ panelId: "p1", sessionIds: ["s1"], createdAt: 1, updatedAt: 2 }],
    };
    s.commitIndexSync(index);
    await s.writeLivePanelsAwaited(live);

    const reread = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    expect(reread.loadIndex()).toEqual(index);
    expect(reread.loadLivePanels()).toEqual(live);
  });

  it("preserves unknown metadata fields across a load → persist round-trip (W3)", () => {
    // Simulate a sidecar written by a newer build that added two fields this
    // build doesn't recognise. After load → persist the unknown fields must
    // round-trip through `unknownFields` and re-appear at the top level on
    // disk, so a re-upgrade to the newer build finds them intact.
    const mem = makeFakeMemento();
    const { fs, files } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    const sidecarPath = `${SNAPS_DIR}/index.json`;
    // Future-build sidecar shape — `experimentalFlag` + `futureCounter` are
    // unknown to this build.
    files.set(
      sidecarPath,
      JSON.stringify({
        version: 1,
        entries: {
          s1: {
            ...makeMeta("s1"),
            experimentalFlag: "rocket",
            futureCounter: 42,
          },
        },
      }),
    );

    const detailed = s.loadIndexDetailed();
    expect(detailed.kind).toBe("valid");
    if (detailed.kind !== "valid") {
      return;
    }
    const meta = detailed.index.entries.s1;
    expect(meta.unknownFields).toEqual({ experimentalFlag: "rocket", futureCounter: 42 });

    // Persist back. The on-disk JSON should show the unknown keys at top
    // level (not nested under `unknownFields`).
    s.commitIndexSync(detailed.index);
    const written = JSON.parse(files.get(sidecarPath) as string) as {
      entries: Record<string, Record<string, unknown>>;
    };
    expect(written.entries.s1.experimentalFlag).toBe("rocket");
    expect(written.entries.s1.futureCounter).toBe(42);
    expect(written.entries.s1.unknownFields).toBeUndefined();
  });

  it("loads a tab's pin, color and icon as known fields, not as a newer build's unknowns", () => {
    const mem = makeFakeMemento();
    const { fs, files } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    files.set(
      `${SNAPS_DIR}/index.json`,
      JSON.stringify({
        version: 1,
        entries: { s1: { ...makeMeta("s1"), pinned: true, tabColor: "red", tabIcon: "rocket" } },
      }),
    );

    const detailed = s.loadIndexDetailed();
    expect(detailed.kind).toBe("valid");
    if (detailed.kind !== "valid") {
      return;
    }
    const meta = detailed.index.entries.s1;
    expect(meta).toMatchObject({ pinned: true, tabColor: "red", tabIcon: "rocket" });
    expect(meta.unknownFields).toBeUndefined();
  });

  it("[W1] literal top-level `unknownFields` key on disk is re-bucketed, not self-promoted", () => {
    // A corrupted / pathological sidecar that contains a literal top-level
    // "unknownFields" key (e.g. a buggy v(N+2) build that mistakenly persisted
    // the in-memory carry-through slot itself). With [W1] fixed, that key
    // gets sieved into the in-memory `unknownFields` bag (where its nested
    // contents will spread to top level on next persist) rather than being
    // recognised as the bag itself. See: .reviews/round-2.md [W1].
    const mem = makeFakeMemento();
    const { fs, files } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    const sidecarPath = `${SNAPS_DIR}/index.json`;
    files.set(
      sidecarPath,
      JSON.stringify({
        version: 1,
        entries: {
          s1: { ...makeMeta("s1"), unknownFields: { tainted: "value" } },
        },
      }),
    );

    const detailed = s.loadIndexDetailed();
    expect(detailed.kind).toBe("valid");
    if (detailed.kind !== "valid") {
      return;
    }
    // The literal `unknownFields` top-level key is itself bucketed as unknown
    // (sieved into the in-memory bag) — NOT trusted as the bag's contents.
    expect(detailed.index.entries.s1.unknownFields).toEqual({ unknownFields: { tainted: "value" } });

    // On re-persist, the key spreads back at the top level (its nested
    // content survives, but as a CONTENT pair, not as the slot itself).
    s.commitIndexSync(detailed.index);
    const written = JSON.parse(files.get(sidecarPath) as string) as {
      entries: Record<string, { unknownFields?: unknown }>;
    };
    expect(written.entries.s1.unknownFields).toEqual({ tainted: "value" });
  });

  it("commitBufferSync and commitBufferAsync produce identical files", async () => {
    const mem = makeFakeMemento();
    const { fs, files } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);

    s.commitBufferSync("sync1", "DATA");
    await s.commitBufferAsync("async1", "DATA", s.currentBufferGen("async1"));

    expect(files.get(bufferFile("sync1"))).toBe("DATA");
    expect(files.get(bufferFile("async1"))).toBe("DATA");
    expect(s.readBufferFile("sync1")).toBe("DATA");
  });

  it("listBufferFiles returns sessionIds of present buffer files", () => {
    const mem = makeFakeMemento();
    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    s.commitBufferSync("alpha", "A");
    s.commitBufferSync("beta", "B");
    expect(s.listBufferFiles().sort()).toEqual(["alpha", "beta"]);
  });

  it("dropBuffer removes only the named file", () => {
    const mem = makeFakeMemento();
    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    s.commitBufferSync("alpha", "A");
    s.commitBufferSync("beta", "B");
    s.dropBuffer("alpha");
    expect(s.listBufferFiles()).toEqual(["beta"]);
    expect(s.readBufferFile("alpha")).toBeNull();
  });

  it("purge() clears workspaceState keys and snapshots directory", async () => {
    const mem = makeFakeMemento({
      [SESSION_SNAPSHOTS_INDEX_KEY]: { version: 1, entries: { s1: makeMeta("s1") } },
      [LIVE_EDITOR_PANELS_KEY]: {
        version: 1,
        panels: [{ panelId: "p", sessionIds: ["s1"], createdAt: 1, updatedAt: 1 }],
      },
    });
    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    s.commitBufferSync("s1", "DATA");

    await s.purge();
    expect(mem.get(SESSION_SNAPSHOTS_INDEX_KEY)).toBeUndefined();
    expect(mem.get(LIVE_EDITOR_PANELS_KEY)).toBeUndefined();
    expect(s.listBufferFiles()).toEqual([]);
  });

  it("migrateMementoIndexToSidecar copies legacy Memento payload + clears it", () => {
    const legacyIndex: SessionSnapshotsIndex = {
      version: 1,
      entries: { s_legacy: makeMeta("s_legacy") },
    };
    const mem = makeFakeMemento({
      [SESSION_SNAPSHOTS_INDEX_KEY]: legacyIndex,
    });
    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);

    s.migrateMementoIndexToSidecar();

    // Sidecar now has the legacy payload.
    const detailed = s.loadIndexDetailed();
    expect(detailed.kind).toBe("valid");
    if (detailed.kind === "valid") {
      expect(detailed.index).toEqual(legacyIndex);
    }
    // Memento entry cleared.
    expect(mem.get(SESSION_SNAPSHOTS_INDEX_KEY)).toBeUndefined();
  });

  it("migrateMementoIndexToSidecar is a no-op when sidecar already exists", () => {
    const sidecarIndex: SessionSnapshotsIndex = { version: 1, entries: { s_new: makeMeta("s_new") } };
    const legacyIndex: SessionSnapshotsIndex = { version: 1, entries: { s_legacy: makeMeta("s_legacy") } };
    const mem = makeFakeMemento({
      [SESSION_SNAPSHOTS_INDEX_KEY]: legacyIndex,
    });
    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    // Seed sidecar via the new API.
    s.commitIndexSync(sidecarIndex);

    s.migrateMementoIndexToSidecar();

    // Sidecar untouched, Memento untouched (legacy data preserved for a
    // potential downgrade — though we don't expose that anymore).
    const detailed = s.loadIndexDetailed();
    expect(detailed.kind).toBe("valid");
    if (detailed.kind === "valid") {
      expect(detailed.index).toEqual(sidecarIndex);
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // [B4] purge() must remove disk artifacts even when workspaceState.update
  // throws (e.g. VS Code raises Canceled mid-shutdown). Same bug shape as
  // the original critical fix's Memento-canceled path. See round-4.md [B4].
  // ───────────────────────────────────────────────────────────────────

  it("purge() removes the snapshots directory even when workspaceState.update throws Canceled (round-4 [B4])", async () => {
    const mem = makeFakeMemento({
      [SESSION_SNAPSHOTS_INDEX_KEY]: { version: 1, entries: { s1: makeMeta("s1") } },
      [LIVE_EDITOR_PANELS_KEY]: {
        version: 1,
        panels: [{ panelId: "p", sessionIds: ["s1"], createdAt: 1, updatedAt: 1 }],
      },
    });
    // Simulate VS Code's mid-shutdown Canceled Thenable on the first Memento
    // update — the exact platform behaviour that produced the original
    // critical-bug fix's need for a sync sidecar. Pre-fix purge() awaits this
    // first, throws unhandled, and never reaches the rmSync that wipes the
    // sidecar + buffer files from disk.
    mem.update.mockImplementationOnce(() => Promise.reject(new Error("Canceled")));

    const { fs } = makeFakeFs();
    const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
    s.commitBufferSync("s1", "DATA");
    // Also seed a sidecar — flushSnapshotsSync writes one at deactivate.
    s.commitIndexSync({ version: 1, entries: { s1: makeMeta("s1") } });

    // Caller treats purge as fire-and-forget; swallow the error so the test
    // simulates production (`void this.storage.purge()`).
    try {
      await s.purge();
    } catch {
      // Expected — first Memento update rejects with Canceled.
    }

    // Disk artifacts MUST be gone even though Memento update threw.
    // Pre-fix: rmSync runs AFTER the awaited Memento updates, so a Canceled
    // first update never reaches the file cleanup.
    expect(s.listBufferFiles()).toEqual([]);
    expect(fs.existsSync(`${SNAPS_DIR}/index.json`)).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────
  // [R-3] Transactional commit invariants (design.md D16).
  // Goal: a stale async commit (whose captured-gen was invalidated by a
  // sync write or drop while it awaited) MUST NOT touch the canonical
  // path — only its own temp file.
  // ───────────────────────────────────────────────────────────────────

  describe("transactional commit API (R-3, D16)", () => {
    it("commitBufferSync writes via temp + atomic rename — no temp file survives", async () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
      s.commitBufferSync("alpha", "DATA");
      expect(files.get(bufferFile("alpha"))).toBe("DATA");
      // No `.tmp.` artifact left over.
      const allFiles = [...files.keys()].filter((k) => k.startsWith(SNAPS_DIR));
      expect(allFiles.filter((k) => k.includes(".tmp."))).toEqual([]);
    });

    it("commitBufferAsync writes via temp + atomic rename", async () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
      const gen = s.currentBufferGen("alpha");
      await s.commitBufferAsync("alpha", "DATA", gen);
      expect(files.get(bufferFile("alpha"))).toBe("DATA");
      const allFiles = [...files.keys()].filter((k) => k.startsWith(SNAPS_DIR));
      expect(allFiles.filter((k) => k.includes(".tmp."))).toEqual([]);
    });

    it("stale commitBufferAsync after a sync write does NOT overwrite the canonical (R5.B1 fix verified at storage layer)", async () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();

      // Hold the async write so we control completion order.
      let releaseAsync: () => void = () => {};
      const heldPromise = new Promise<void>((resolve) => {
        releaseAsync = resolve;
      });
      const realWriteFile = fs.promises.writeFile;
      fs.promises.writeFile = vi.fn(async (f: string, d: string) => {
        await heldPromise;
        return realWriteFile(f, d);
      });

      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);

      // Capture pre-gen, kick async write (held in promises.writeFile).
      const capturedGen = s.currentBufferGen("alpha");
      const asyncCommit = s.commitBufferAsync("alpha", "ASYNC_STALE", capturedGen);

      // Sync writer lands FIRST — bumps gen and writes canonical synchronously.
      s.commitBufferSync("alpha", "SYNC_FRESH");
      expect(files.get(bufferFile("alpha"))).toBe("SYNC_FRESH");

      // Release the async write. It re-checks the gen, finds mismatch, unlinks
      // ONLY its temp. The canonical must still show SYNC_FRESH.
      releaseAsync();
      await asyncCommit;
      expect(files.get(bufferFile("alpha"))).toBe("SYNC_FRESH");

      // No temp file left over.
      const allFiles = [...files.keys()].filter((k) => k.startsWith(SNAPS_DIR));
      expect(allFiles.filter((k) => k.includes(".tmp."))).toEqual([]);
    });

    it("stale commitBufferAsync after a dropBuffer does NOT recreate the canonical", async () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();

      let releaseAsync: () => void = () => {};
      const heldPromise = new Promise<void>((resolve) => {
        releaseAsync = resolve;
      });
      const realWriteFile = fs.promises.writeFile;
      fs.promises.writeFile = vi.fn(async (f: string, d: string) => {
        await heldPromise;
        return realWriteFile(f, d);
      });

      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
      // Seed an existing canonical.
      s.commitBufferSync("alpha", "INITIAL");
      const capturedGen = s.currentBufferGen("alpha");

      const asyncCommit = s.commitBufferAsync("alpha", "ASYNC_STALE", capturedGen);

      // Drop bumps the gen and unlinks the canonical SYNCHRONOUSLY.
      s.dropBuffer("alpha");
      expect(files.get(bufferFile("alpha"))).toBeUndefined();

      // Release the async write. It must NOT recreate the canonical.
      releaseAsync();
      await asyncCommit;
      expect(files.get(bufferFile("alpha"))).toBeUndefined();

      const allFiles = [...files.keys()].filter((k) => k.startsWith(SNAPS_DIR));
      expect(allFiles.filter((k) => k.includes(".tmp."))).toEqual([]);
    });

    it("commitIndexSync writes the sidecar atomically via temp + rename", () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
      const idx: SessionSnapshotsIndex = { version: 1, entries: { s1: makeMeta("s1") } };
      s.commitIndexSync(idx);
      expect(JSON.parse(files.get(`${SNAPS_DIR}/index.json`) ?? "")).toEqual(idx);
      const allFiles = [...files.keys()].filter((k) => k.startsWith(SNAPS_DIR));
      expect(allFiles.filter((k) => k.includes(".tmp."))).toEqual([]);
    });

    it("stale commitIndexAsync after commitIndexSync does NOT overwrite the sidecar (R5.B2 fix verified)", async () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();

      let releaseAsync: () => void = () => {};
      const heldPromise = new Promise<void>((resolve) => {
        releaseAsync = resolve;
      });
      const realWriteFile = fs.promises.writeFile;
      fs.promises.writeFile = vi.fn(async (f: string, d: string) => {
        await heldPromise;
        return realWriteFile(f, d);
      });

      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
      const stale: SessionSnapshotsIndex = {
        version: 1,
        entries: { s1: makeMeta("s1", { snapshotAt: 1 }) },
      };
      const fresh: SessionSnapshotsIndex = {
        version: 1,
        entries: { s1: makeMeta("s1", { snapshotAt: 999 }) },
      };

      const capturedGen = s.currentSidecarGen();
      const asyncCommit = s.commitIndexAsync(stale, capturedGen);
      s.commitIndexSync(fresh);
      expect(JSON.parse(files.get(`${SNAPS_DIR}/index.json`) ?? "")).toEqual(fresh);

      releaseAsync();
      await asyncCommit;
      // The sidecar must still reflect the SYNC write — stale async lost.
      expect(JSON.parse(files.get(`${SNAPS_DIR}/index.json`) ?? "")).toEqual(fresh);

      const allFiles = [...files.keys()].filter((k) => k.startsWith(SNAPS_DIR));
      expect(allFiles.filter((k) => k.includes(".tmp."))).toEqual([]);
    });

    /** An async buffer commit whose rename runs only after `between` has run. */
    async function lateRename(
      s: SessionStorage,
      fs: SessionStorageFs,
      data: string,
      between: () => void,
    ): Promise<string> {
      const realRename = fs.promises.rename;
      let started = false;
      let release: () => void = () => {};
      fs.promises.rename = vi.fn(async (from: string, to: string) => {
        if (!started) {
          started = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return realRename(from, to);
      });
      const commit = s.commitBufferAsync("alpha", data, s.currentBufferGen("alpha"));
      await vi.waitFor(() => expect(started).toBe(true));
      between();
      release();
      return commit;
    }

    it("post-rename (R6.W1): a stale rename landing on a sync WRITE leaves the older snapshot, not nothing", async () => {
      // The sync writer's data is gone either way — our rename overwrote it.
      // Removing canonical too lost the tab on restore; the older snapshot is
      // still the session's, and the next commit replaces it.
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
      const outcome = await lateRename(s, fs, "ASYNC_OLDER", () => s.commitBufferSync("alpha", "SYNC_FRESH"));
      expect(outcome).toBe("stale-post-rename");
      expect(files.get(bufferFile("alpha"))).toBe("ASYNC_OLDER");
    });

    it("post-rename (R6.W1): a stale rename landing on a CLEAR is removed — cleared content stays gone", async () => {
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
      const outcome = await lateRename(s, fs, "SECRET", () => s.commitBufferSync("alpha", "", { erase: true }));
      expect(outcome).toBe("stale-post-rename");
      expect(files.has(bufferFile("alpha"))).toBe(false);
    });

    it("post-rename: with no usable file identity (inode 0), an erase still removes, a write still keeps", async () => {
      for (const [between, expected] of [
        [(st: SessionStorage) => st.commitBufferSync("alpha", "", { erase: true }), undefined],
        [(st: SessionStorage) => st.commitBufferSync("alpha", "SYNC"), "ASYNC"],
      ] as const) {
        const { fs, files } = makeFakeFs();
        fs.promises.stat = async () => ({ dev: 0, ino: 0 });
        const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
        await lateRename(s, fs, "ASYNC", () => between(s));
        expect(files.get(bufferFile("alpha"))).toBe(expected);
      }
    });

    it("post-rename: a stale sidecar landing on a sync sidecar is kept — an older index beats none", async () => {
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
      const realRename = fs.promises.rename;
      let release: () => void = () => {};
      let started = false;
      fs.promises.rename = vi.fn(async (from: string, to: string) => {
        if (!started) {
          started = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return realRename(from, to);
      });
      const older: SessionSnapshotsIndex = { version: 1, entries: { s1: makeMeta("s1") } };
      const commit = s.commitIndexAsync(older, s.currentSidecarGen());
      await vi.waitFor(() => expect(started).toBe(true));
      s.commitIndexSync({ version: 1, entries: { s2: makeMeta("s2") } });
      release();
      expect(await commit).toBe("stale-post-rename");
      expect(JSON.parse(files.get(`${SNAPS_DIR}/index.json`) ?? "{}")).toEqual(older);
    });

    // The other order of the same race: the async rename lands on disk FIRST,
    // and a sync writer's rename replaces it before the async await returns.
    // Canonical then holds the sync writer's NEWER data, and the post-rename
    // recheck unlinked it anyway — the tab vanished on the next restore.
    function renameThatLandsThenWaits(fs: SessionStorageFs): () => void {
      const realRename = fs.promises.rename;
      let release: () => void = () => {};
      let held = false;
      fs.promises.rename = vi.fn(async (from: string, to: string) => {
        await realRename(from, to); // on disk now
        if (!held) {
          held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      });
      return () => release();
    }

    it("keeps a sync writer's buffer that replaced the async rename after it landed", async () => {
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
      const release = renameThatLandsThenWaits(fs);

      const asyncCommit = s.commitBufferAsync("alpha", "ASYNC_OLDER", s.currentBufferGen("alpha"));
      await vi.waitFor(() => expect(files.get(bufferFile("alpha"))).toBe("ASYNC_OLDER"));
      s.commitBufferSync("alpha", "SYNC_FRESH");
      release();

      expect(await asyncCommit).toBe("stale-post-rename");
      expect(files.get(bufferFile("alpha"))).toBe("SYNC_FRESH");
    });

    it("keeps a sync sidecar that replaced the async rename after it landed", async () => {
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
      const release = renameThatLandsThenWaits(fs);
      const sidecar = `${SNAPS_DIR}/index.json`;

      const older: SessionSnapshotsIndex = { version: 1, entries: { s1: makeMeta("s1") } };
      const asyncCommit = s.commitIndexAsync(older, s.currentSidecarGen());
      await vi.waitFor(() => expect(files.has(sidecar)).toBe(true));
      const fresh: SessionSnapshotsIndex = { version: 1, entries: { s2: makeMeta("s2") } };
      s.commitIndexSync(fresh);
      const freshText = files.get(sidecar);
      release();

      expect(await asyncCommit).toBe("stale-post-rename");
      expect(files.get(sidecar)).toBe(freshText);
    });

    it("still removes a dropped session's buffer that the async rename recreated", async () => {
      // Privacy: a drop (or a clear) must not be undone by a write already in flight.
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(makeFakeMemento() as unknown as vscode.Memento, STORAGE_URI, fs);
      const realRename = fs.promises.rename;
      let release: () => void = () => {};
      fs.promises.rename = vi.fn(async (from: string, to: string) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await realRename(from, to);
      });

      const asyncCommit = s.commitBufferAsync("alpha", "SECRET", s.currentBufferGen("alpha"));
      await vi.waitFor(() => expect(fs.promises.rename).toHaveBeenCalled());
      s.dropBuffer("alpha");
      release();

      expect(await asyncCommit).toBe("stale-post-rename");
      expect(files.has(bufferFile("alpha"))).toBe(false);
    });

    it("cleanupOrphanTemps removes leftover *.tmp.* files from a prior crashed write", () => {
      const mem = makeFakeMemento();
      const { fs, files } = makeFakeFs();
      const s = new SessionStorage(mem as unknown as vscode.Memento, STORAGE_URI, fs);
      // Seed a canonical + a stray temp.
      s.commitBufferSync("alpha", "DATA");
      // Simulate orphan: write directly to a temp path.
      files.set(`${SNAPS_DIR}/alpha.snapshot.ans.tmp.999`, "STALE");
      expect(files.get(`${SNAPS_DIR}/alpha.snapshot.ans.tmp.999`)).toBe("STALE");

      s.cleanupOrphanTemps();

      expect(files.get(`${SNAPS_DIR}/alpha.snapshot.ans.tmp.999`)).toBeUndefined();
      expect(files.get(bufferFile("alpha"))).toBe("DATA");
    });
  });
});
