// Pins the three double behaviours a plausible "simplification" of the shared
// factories would silently break, leaving the migrated suites green for the
// wrong reason. See share-session-manager-test-fixtures/design.md § D5,
// rows OBL-4 (serialize identity), OBL-5 (disposal), OBL-6 (write sink).

import { describe, expect, it } from "vitest";
import { headlessFactories, sessionStorageMock } from "./sessionMocks";

describe("headlessFactories — serialize identity (OBL-4)", () => {
  it("gives each addon its own construction index, so a captured value is stable per addon", () => {
    const fx = headlessFactories({ serialize: (n) => `BUF#${n}` });

    const first = fx.serialize();
    const second = fx.serialize();

    // persist.test.ts's contract: it captures BUF#n once per addon.
    expect(first.serialize()).toBe("BUF#1");
    expect(first.serialize()).toBe("BUF#1");
    expect(second.serialize()).toBe("BUF#2");
  });

  it("invokes the closure on every serialize() call, so a per-call counter advances", () => {
    let calls = 0;
    const fx = headlessFactories({ serialize: () => `BUF#${++calls}` });

    const addon = fx.serialize();

    // This is shutdownLifecycle.test.ts's contract: one addon, a new payload
    // per read, so pre-clear and post-clear writes are tellable apart.
    expect(addon.serialize()).toBe("BUF#1");
    expect(addon.serialize()).toBe("BUF#2");
    expect(addon.serialize()).toBe("BUF#3");
  });

  it("lets a suite hand back a one-shot override and then resume its counter", () => {
    let count = 0;
    let next: string | null = null;
    const fx = headlessFactories({
      serialize: () => {
        if (next !== null) {
          const v = next;
          next = null;
          return v;
        }
        return `BUF#${++count}`;
      },
    });

    const addon = fx.serialize();
    expect(addon.serialize()).toBe("BUF#1");
    next = "CLEARED";
    expect(addon.serialize()).toBe("CLEARED");
    expect(addon.serialize()).toBe("BUF#2");
  });

  it("falls back to a per-addon default when no closure is passed", () => {
    const fx = headlessFactories();

    expect(fx.serialize().serialize()).toBe("BUF#1");
    expect(fx.serialize().serialize()).toBe("BUF#2");
  });
});

describe("headlessFactories — disposal tracking (OBL-5)", () => {
  it("flips disposed only when that object's own dispose() runs", () => {
    const fx = headlessFactories({ track: true });

    const term = fx.headless(80, 24);
    const addon = fx.serialize();

    expect(fx.builtHeadless).toHaveLength(1);
    expect(fx.builtAddons).toHaveLength(1);
    expect(fx.builtHeadless[0].disposed).toBe(false);
    expect(fx.builtAddons[0].disposed).toBe(false);

    term.dispose();
    expect(fx.builtHeadless[0].disposed).toBe(true);
    // Disposing the terminal must not dispose the addon.
    expect(fx.builtAddons[0].disposed).toBe(false);

    addon.dispose();
    expect(fx.builtAddons[0].disposed).toBe(true);
  });

  it("tracks each construction separately", () => {
    const fx = headlessFactories({ track: true });

    fx.headless(80, 24);
    const second = fx.headless(100, 30);
    second.dispose();

    expect(fx.builtHeadless).toHaveLength(2);
    expect(fx.builtHeadless[0].disposed).toBe(false);
    expect(fx.builtHeadless[1].disposed).toBe(true);
    expect(fx.builtHeadless[1].cols).toBe(100);
  });

  it("records nothing when track is off", () => {
    const fx = headlessFactories();

    fx.headless(80, 24);
    fx.serialize();

    expect(fx.builtHeadless).toHaveLength(0);
    expect(fx.builtAddons).toHaveLength(0);
  });
});

describe("headlessFactories — write sink (OBL-6)", () => {
  it("records every payload in order and still fires the callback", () => {
    const writes: string[] = [];
    const fx = headlessFactories({ onWrite: (d) => writes.push(d) });

    const term = fx.headless(80, 24);
    let callbacks = 0;
    term.write("alpha", () => {
      callbacks += 1;
    });
    term.write("beta", () => {
      callbacks += 1;
    });

    // Both halves matter: dropping the sink loses exit.test.ts's assertions,
    // dropping the callback leaves the flush barrier permanently closed.
    expect(writes).toEqual(["alpha", "beta"]);
    expect(callbacks).toBe(2);
  });

  it("still fires the callback when no sink is passed", () => {
    const fx = headlessFactories();

    let fired = false;
    fx.headless(80, 24).write("alpha", () => {
      fired = true;
    });

    expect(fired).toBe(true);
  });

  it("tolerates a write with no callback", () => {
    const writes: string[] = [];
    const fx = headlessFactories({ onWrite: (d) => writes.push(d) });

    expect(() => fx.headless(80, 24).write("alpha")).not.toThrow();
    expect(writes).toEqual(["alpha"]);
  });
});

describe("sessionStorageMock — buffer read-back default", () => {
  it("refuses to read back a committed buffer when buffers is absent", () => {
    const storage = sessionStorageMock();

    storage.commitBufferSync("s1", "DATA");

    expect(storage.readBufferFile("s1")).toBeNull();
    expect(storage.listBufferFiles()).toEqual([]);
  });

  it("reads a committed buffer back when buffers is passed, and stops after dropBuffer", () => {
    const storage = sessionStorageMock({ buffers: {} });

    storage.commitBufferSync("s1", "DATA");
    expect(storage.readBufferFile("s1")).toBe("DATA");
    expect(storage.listBufferFiles()).toEqual(["s1"]);

    storage.dropBuffer("s1");
    expect(storage.readBufferFile("s1")).toBeNull();
    expect(storage.listBufferFiles()).toEqual([]);
  });

  it("serves a seeded buffer without a commit", () => {
    const storage = sessionStorageMock({ buffers: { s1: "SEEDED" } });

    expect(storage.readBufferFile("s1")).toBe("SEEDED");
    expect(storage.readBufferFile("absent")).toBeNull();
  });
});

describe("sessionStorageMock — generation bookkeeping", () => {
  it("reports stale-skipped for a generation captured before a sync commit", async () => {
    const storage = sessionStorageMock();

    const captured = storage.currentBufferGen("s1");
    storage.commitBufferSync("s1", "DATA");

    await expect(storage.commitBufferAsync("s1", "DATA", captured)).resolves.toBe("stale-skipped");
    await expect(storage.commitBufferAsync("s1", "DATA", storage.currentBufferGen("s1"))).resolves.toBe("renamed");
  });

  it("keeps generations per id", async () => {
    const storage = sessionStorageMock();

    const capturedTwo = storage.currentBufferGen("s2");
    storage.commitBufferSync("s1", "DATA");

    // Bumping s1 must not invalidate a write captured against s2.
    await expect(storage.commitBufferAsync("s2", "DATA", capturedTwo)).resolves.toBe("renamed");
  });

  it("bumps the buffer generation on dropBuffer", async () => {
    const storage = sessionStorageMock();

    const captured = storage.currentBufferGen("s1");
    storage.dropBuffer("s1");

    await expect(storage.commitBufferAsync("s1", "DATA", captured)).resolves.toBe("stale-skipped");
  });

  it("tracks the sidecar generation independently of any buffer", async () => {
    const storage = sessionStorageMock();

    const captured = storage.currentSidecarGen();
    storage.commitIndexSync({});

    await expect(storage.commitIndexAsync({}, captured)).resolves.toBe("stale-skipped");
    await expect(storage.commitIndexAsync({}, storage.currentSidecarGen())).resolves.toBe("renamed");
  });
});
