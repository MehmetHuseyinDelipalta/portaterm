import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "./SessionManager";

afterEach(() => {
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SessionManager spawn gate", () => {
  it("has nothing to wait for by default", () => {
    const sm = new SessionManager();
    expect(sm.whenSpawnReady()).toBeUndefined();
    sm.dispose();
  });

  it("waits for the gate, then has nothing to wait for", async () => {
    const sm = new SessionManager();
    const ready = deferred();
    sm.setSpawnGate(ready.promise, 60_000);
    const wait = sm.whenSpawnReady();
    expect(wait).toBeInstanceOf(Promise);
    let open = false;
    void wait?.then(() => {
      open = true;
    });
    await Promise.resolve();
    expect(open).toBe(false);

    ready.resolve();
    await wait;
    expect(sm.whenSpawnReady()).toBeUndefined();
    sm.dispose();
  });

  it("opens, rather than rejects, when the gate rejects", async () => {
    const sm = new SessionManager();
    const ready = deferred();
    sm.setSpawnGate(ready.promise, 60_000);
    const wait = sm.whenSpawnReady();
    ready.reject(new Error("boom"));
    await expect(wait).resolves.toBeUndefined();
    expect(sm.whenSpawnReady()).toBeUndefined();
    sm.dispose();
  });

  it("opens after the wait runs out, and leaves no timer behind when the gate wins", async () => {
    vi.useFakeTimers();
    const sm = new SessionManager();
    sm.setSpawnGate(new Promise(() => {}), 2000);
    const wait = sm.whenSpawnReady();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sm.whenSpawnReady()).toBe(wait);
    await vi.advanceTimersByTimeAsync(1);
    expect(sm.whenSpawnReady()).toBeUndefined();

    sm.setSpawnGate(Promise.resolve(), 2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(sm.whenSpawnReady()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    sm.dispose();
  });

  it("is not opened by an earlier gate settling after a later one was set", async () => {
    const sm = new SessionManager();
    const first = deferred();
    const second = deferred();
    sm.setSpawnGate(first.promise, 60_000);
    const firstWait = sm.whenSpawnReady();
    sm.setSpawnGate(second.promise, 60_000);

    first.resolve();
    await firstWait;
    expect(sm.whenSpawnReady()).toBeInstanceOf(Promise);

    second.resolve();
    await sm.whenSpawnReady();
    expect(sm.whenSpawnReady()).toBeUndefined();
    sm.dispose();
  });
});
