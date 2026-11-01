// src/session/MirrorWrites.test.ts — a flush waits for exactly the mirror writes
// issued before it, at a cost of two counters per write (perf A4).

import { describe, expect, it, vi } from "vitest";
import { MirrorWrites } from "./MirrorWrites";

/** A mirror that parses only when told to, calling back in write order as xterm does. */
function fakeMirror() {
  const queue: Array<() => void> = [];
  const callbacks: Array<(() => void) | undefined> = [];
  return {
    write: vi.fn((_data: string, callback?: () => void) => {
      callbacks.push(callback);
      queue.push(() => callback?.());
    }),
    parse(count = 1) {
      for (let i = 0; i < count; i++) {
        queue.shift()?.();
      }
    },
    callbacks,
  };
}

const state = async (p: Promise<void>) => {
  let done = false;
  void p.then(() => {
    done = true;
  });
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  return done;
};

describe("MirrorWrites", () => {
  it("is settled with nothing written", async () => {
    expect(await state(new MirrorWrites().settled())).toBe(true);
  });

  it("settles once every write issued so far is parsed", async () => {
    const writes = new MirrorWrites();
    const mirror = fakeMirror();
    writes.write(mirror, "a", vi.fn());
    writes.write(mirror, "b", vi.fn());
    const settled = writes.settled();
    mirror.parse(1);
    expect(await state(settled)).toBe(false);
    mirror.parse(1);
    expect(await state(settled)).toBe(true);
    expect(mirror.write.mock.calls.map(([d]) => d)).toEqual(["a", "b"]);
  });

  it("is not held up by writes issued after it was asked", async () => {
    const writes = new MirrorWrites();
    const mirror = fakeMirror();
    writes.write(mirror, "a", vi.fn());
    const settled = writes.settled();
    writes.write(mirror, "b", vi.fn());
    mirror.parse(1);
    expect(await state(settled)).toBe(true);
    const later = writes.settled();
    expect(await state(later)).toBe(false);
    mirror.parse(1);
    expect(await state(later)).toBe(true);
  });

  it("settles each waiter at its own point", async () => {
    const writes = new MirrorWrites();
    const mirror = fakeMirror();
    writes.write(mirror, "a", vi.fn());
    const first = writes.settled();
    writes.write(mirror, "b", vi.fn());
    writes.write(mirror, "c", vi.fn());
    const second = writes.settled();
    mirror.parse(1);
    expect([await state(first), await state(second)]).toEqual([true, false]);
    mirror.parse(1);
    expect(await state(second)).toBe(false);
    mirror.parse(1);
    expect(await state(second)).toBe(true);
  });

  it("does not count a write the mirror refused, and reports it", async () => {
    const writes = new MirrorWrites();
    const mirror = fakeMirror();
    writes.write(mirror, "a", vi.fn());
    const onError = vi.fn();
    const broken = {
      write: () => {
        throw new Error("disposed");
      },
    };
    writes.write(broken, "b", onError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "disposed" }));
    const settled = writes.settled();
    mirror.parse(1);
    expect(await state(settled)).toBe(true);
  });

  it("settles at once when the only write was refused", async () => {
    const writes = new MirrorWrites();
    writes.write(
      {
        write: () => {
          throw new Error("disposed");
        },
      },
      "a",
      vi.fn(),
    );
    expect(await state(writes.settled())).toBe(true);
  });

  it("releases its waiters when the mirror goes", async () => {
    const writes = new MirrorWrites();
    const mirror = fakeMirror();
    writes.write(mirror, "a", vi.fn());
    const settled = writes.settled();
    writes.release();
    expect(await state(settled)).toBe(true);
  });

  it("hands the mirror one shared callback, allocating nothing per write", () => {
    const writes = new MirrorWrites();
    const mirror = fakeMirror();
    for (const data of ["a", "b", "c"]) {
      writes.write(mirror, data, vi.fn());
    }
    expect(new Set(mirror.callbacks).size).toBe(1);
  });
});
