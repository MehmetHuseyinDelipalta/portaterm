import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJsonlFollowCache, type OpenFn } from "./jsonlFollow";
import { streamJsonlObjects } from "./jsonlStream";

type Rec = Record<string, unknown>;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsonl-follow-"));
  file = path.join(dir, "t.jsonl");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Real `fs.open`, counting the bytes every read asks for. */
function countingOpen(): { open: OpenFn; bytes: () => number; reset: () => void } {
  let bytes = 0;
  const open: OpenFn = async (p) => {
    const handle = await fs.open(p, "r");
    return {
      stat: () => handle.stat(),
      read: async (buffer, offset, length, position) => {
        const r = await handle.read(buffer, offset, length, position);
        bytes += r.bytesRead;
        return r;
      },
      close: () => handle.close(),
    };
  };
  return {
    open,
    bytes: () => bytes,
    reset: () => {
      bytes = 0;
    },
  };
}

/** A cache read that collects every fed (record, lineNo) into a fresh-or-kept list. */
function collect(cache: ReturnType<typeof createJsonlFollowCache>, key = "k", p = file) {
  const init = vi.fn(() => [] as Array<{ record: Rec; lineNo: number }>);
  const fed: Array<{ record: Rec; lineNo: number }> = [];
  return {
    init,
    fed,
    run: () =>
      cache.read(
        key,
        p,
        init,
        (state, record, lineNo) => {
          state.push({ record, lineNo });
          fed.push({ record, lineNo });
        },
        (state) => state.map((s) => ({ ...s })),
      ),
  };
}

async function oracle(p: string): Promise<Array<{ record: Rec; lineNo: number }>> {
  const out: Array<{ record: Rec; lineNo: number }> = [];
  for await (const item of streamJsonlObjects(p)) {
    out.push(item);
  }
  return out;
}

const line = (n: number, extra = "") => JSON.stringify({ n, text: `line ${n}${extra}` });

describe("jsonlFollow: a fresh read", () => {
  it("yields what streamJsonlObjects yields, with the same physical line numbers", async () => {
    const content = [
      line(1),
      "",
      "{not json",
      "null",
      "42",
      '"a string"',
      "[1,2]",
      `${line(2)}\r`,
      `  ${JSON.stringify({ t: "ünïcödé — 日本語 🎉" })}  `,
      "\t",
      line(3),
    ].join("\n");
    await fs.writeFile(file, `${content}\n`);

    const result = await collect(createJsonlFollowCache()).run();

    expect(result).toEqual(await oracle(file));
    expect(result?.map((r) => r.lineNo)).toEqual([1, 7, 8, 9, 11]);
  });

  it("matches across chunk boundaries, including a multi-byte character split by one", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ i, s: "é日🎉".repeat(i % 7) }));
    await fs.writeFile(file, `${lines.join("\n")}\n`);

    for (const chunkBytes of [1, 3, 7, 64]) {
      const result = await collect(createJsonlFollowCache({ chunkBytes })).run();
      expect(result).toEqual(await oracle(file));
    }
  });

  it("consumes a complete unterminated last line, as the stream does", async () => {
    await fs.writeFile(file, `${line(1)}\n${line(2)}`);
    const result = await collect(createJsonlFollowCache()).run();
    expect(result).toEqual(await oracle(file));
    expect(result).toHaveLength(2);
  });

  it("answers finish(init()) for an empty file, and null for one it cannot read", async () => {
    await fs.writeFile(file, "");
    const cache = createJsonlFollowCache();
    await expect(collect(cache).run()).resolves.toEqual([]);
    await expect(collect(cache, "dir", dir).run()).resolves.toBeNull();
    await expect(collect(cache, "missing", path.join(dir, "nope.jsonl")).run()).resolves.toBeNull();
  });

  it("lets a throwing feed cost one record, not the file", async () => {
    await fs.writeFile(file, `${[1, 2, 3, 4].map((n) => line(n)).join("\n")}\n`);
    let calls = 0;
    const result = await createJsonlFollowCache().read(
      "k",
      file,
      () => [] as number[],
      (state, record) => {
        calls++;
        if (calls === 2) {
          throw new Error("boom");
        }
        state.push(record.n as number);
      },
      (state) => [...state],
    );
    expect(result).toEqual([1, 3, 4]);
  });
});

describe("jsonlFollow: a re-read", () => {
  it("reads and feeds nothing again when the file has not changed", async () => {
    await fs.writeFile(file, `${line(1)}\n${line(2)}\n`);
    const counter = countingOpen();
    const cache = createJsonlFollowCache({ open: counter.open });
    const reader = collect(cache);
    const first = await reader.run();

    counter.reset();
    const second = await reader.run();

    expect(second).toEqual(first);
    expect(reader.init).toHaveBeenCalledTimes(1);
    expect(reader.fed).toHaveLength(2);
    // Only the boundary check: at most 64 bytes before the end, twice (check + re-stamp).
    expect(counter.bytes()).toBeLessThanOrEqual(128);
  });

  it("reads and parses only the appended bytes, continuing the line count", async () => {
    const head = Array.from({ length: 200 }, (_, i) => line(i + 1, " padding".repeat(20))).join("\n");
    await fs.writeFile(file, `${head}\n`);
    const counter = countingOpen();
    const cache = createJsonlFollowCache({ open: counter.open });
    const reader = collect(cache);
    await reader.run();
    const size = (await fs.stat(file)).size;

    const appended = `\n${line(1000)}\n`;
    await fs.appendFile(file, appended);
    counter.reset();
    reader.fed.length = 0;
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(1);
    expect(reader.fed).toEqual([{ record: { n: 1000, text: "line 1000" }, lineNo: 202 }]);
    expect(counter.bytes()).toBeLessThan(size / 10);
    expect(result).toEqual(await oracle(file));
  });

  it("leaves a line the writer has not finished for the next read, and feeds it once", async () => {
    await fs.writeFile(file, `${line(1)}\n{"n":2,"te`);
    const cache = createJsonlFollowCache();
    const reader = collect(cache);
    expect(await reader.run()).toHaveLength(1);

    await fs.appendFile(file, `xt":"two"}\n${line(3)}\n`);
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(1);
    expect(reader.fed.map((f) => f.record.n)).toEqual([1, 2, 3]);
    expect(result).toEqual(await oracle(file));
  });

  it("ends a consumed unterminated line with its late LF instead of counting a blank line", async () => {
    // Codex stamps the physical line onto each record as its `#n` locator, so
    // the count must stay the one a full read gives.
    await fs.writeFile(file, `${line(1)}\n${line(2)}`);
    const reader = collect(createJsonlFollowCache());
    await reader.run();

    await fs.appendFile(file, `\n${line(3)}\n`);
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(1);
    expect(result).toEqual(await oracle(file));
    expect(result?.map((r) => r.lineNo)).toEqual([1, 2, 3]);
  });

  it("starts over when bytes were appended to a consumed unterminated line", async () => {
    await fs.writeFile(file, `${line(1)}\n${line(2)}`);
    const reader = collect(createJsonlFollowCache());
    await reader.run();

    await fs.appendFile(file, `${line(3)}\n`); // line 2 is now `{...}{...}`: corrupt
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(2);
    expect(result).toEqual(await oracle(file));
    expect(result?.map((r) => r.record.n)).toEqual([1]);
  });

  it("starts over when the file is shorter than what was consumed", async () => {
    await fs.writeFile(file, `${line(1)}\n${line(2)}\n`);
    const reader = collect(createJsonlFollowCache());
    await reader.run();

    await fs.truncate(file, 0);
    await fs.appendFile(file, `${line(9)}\n`);
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(2);
    expect(result?.map((r) => r.record.n)).toEqual([9]);
  });

  it("starts over for another file renamed into place", async () => {
    await fs.writeFile(file, `${line(1)}\n`);
    const reader = collect(createJsonlFollowCache());
    await reader.run();

    const other = path.join(dir, "other.jsonl");
    await fs.writeFile(other, `${line(7)}\n${line(8)}\n`);
    await fs.rename(other, file);
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(2);
    expect(result?.map((r) => r.record.n)).toEqual([7, 8]);
  });

  it("starts over for another file renamed into place even when it ends the same way", async () => {
    // Only the inode tells these apart: the bytes where the last read stopped match.
    const sameEnd = JSON.stringify({ n: 2, text: "an ending long enough to fill the whole compared boundary" });
    await fs.writeFile(
      file,
      `${line(1)}
${sameEnd}
`,
    );
    const reader = collect(createJsonlFollowCache());
    await reader.run();

    const other = path.join(dir, "other.jsonl");
    await fs.writeFile(
      other,
      `${line(5)}
${sameEnd}
${line(3)}
`,
    );
    await fs.rename(other, file);
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(2);
    expect(result?.map((r) => r.record.n)).toEqual([5, 2, 3]);
  });

  it("starts over when the bytes where it stopped were rewritten in place", async () => {
    await fs.writeFile(file, `${line(1)}\n${line(2)}\n`);
    const reader = collect(createJsonlFollowCache());
    await reader.run();

    const handle = await fs.open(file, "r+");
    try {
      const rewritten = Buffer.from(`${line(5)}\n${line(6)}\n`);
      await handle.write(rewritten, 0, rewritten.length, 0);
    } finally {
      await handle.close();
    }
    await fs.appendFile(file, `${line(7)}\n`);
    const result = await reader.run();

    expect(reader.init).toHaveBeenCalledTimes(2);
    expect(result?.map((r) => r.record.n)).toEqual([5, 6, 7]);
  });

  it("discards the kept state after a failed read and starts over", async () => {
    await fs.writeFile(file, `${line(1)}\n`);
    let fail = false;
    const open: OpenFn = async (p) => {
      const handle = await fs.open(p, "r");
      return {
        stat: () => handle.stat(),
        read: (b, o, l, pos) => (fail ? Promise.reject(new Error("EIO")) : handle.read(b, o, l, pos)),
        close: () => handle.close(),
      };
    };
    const cache = createJsonlFollowCache({ open });
    const reader = collect(cache);
    await reader.run();
    expect(cache.size).toBe(1);

    fail = true;
    await fs.appendFile(file, `${line(2)}\n`);
    expect(await reader.run()).toBeNull();
    expect(cache.size).toBe(0);

    fail = false;
    const result = await reader.run();
    expect(reader.init).toHaveBeenCalledTimes(2);
    expect(result?.map((r) => r.record.n)).toEqual([1, 2]);
  });

  it("runs two reads of one key one after the other, so no line is fed twice", async () => {
    await fs.writeFile(file, `${line(1)}\n`);
    const reader = collect(createJsonlFollowCache());
    await reader.run();
    await fs.appendFile(file, `${line(2)}\n${line(3)}\n`);

    const [a, b] = await Promise.all([reader.run(), reader.run()]);

    expect(reader.fed.map((f) => f.record.n)).toEqual([1, 2, 3]);
    expect(a).toEqual(b);
  });

  it("keeps separate state per key, and forgets the least recently used past its bound", async () => {
    await fs.writeFile(file, `${line(1)}\n`);
    const cache = createJsonlFollowCache({ maxEntries: 2 });
    const a = collect(cache, "a");
    const b = collect(cache, "b");
    const c = collect(cache, "c");
    await a.run();
    await b.run();
    await a.run(); // a is now the most recent
    await c.run(); // evicts b

    expect(cache.size).toBe(2);
    await a.run();
    await b.run();
    expect(a.init).toHaveBeenCalledTimes(1);
    expect(b.init).toHaveBeenCalledTimes(2);
  });

  it("forgets everything on clear", async () => {
    await fs.writeFile(file, `${line(1)}\n`);
    const cache = createJsonlFollowCache();
    const reader = collect(cache);
    await reader.run();
    cache.clear();
    await reader.run();
    expect(reader.init).toHaveBeenCalledTimes(2);
  });
});
