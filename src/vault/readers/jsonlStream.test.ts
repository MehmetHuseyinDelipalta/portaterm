// src/vault/readers/jsonlStream.test.ts — direct test for the shared JSONL
// stream lifecycle (share-jsonl-stream-lifecycle OBL-1/2/4/5/7). Fixtures are
// real files on a temp dir: the whole point of the module is node:fs + readline
// behaviour, which a stubbed stream would not exercise.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamJsonlLines, streamJsonlObjects } from "./jsonlStream";

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-jsonl-stream-"));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
  vi.doUnmock("node:fs");
  vi.doUnmock("node:readline");
  vi.resetModules();
});

async function fixture(name: string, contents: string): Promise<string> {
  const file = path.join(dir, name);
  await fsp.writeFile(file, contents);
  return file;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) {
    out.push(item);
  }
  return out;
}

describe("streamJsonlObjects", () => {
  it("skips a corrupt line and keeps reading, without shifting later line numbers", async () => {
    const file = await fixture(
      "corrupt-middle.jsonl",
      `{"n":1}\n{"n":2,\n{"n":3}\n`, // line 2 is truncated mid-record
    );

    const got = await collect(streamJsonlObjects(file));

    expect(got).toEqual([
      { record: { n: 1 }, lineNo: 1 },
      { record: { n: 3 }, lineNo: 3 },
    ]);
  });

  it("admits exactly the non-null typeof-object values, arrays included", async () => {
    // Arrays are records to every current call site — `typeof [] === "object"`
    // and all six predicates admit them. Narrowing here would silently drop
    // lines those readers see today.
    const file = await fixture("shapes.jsonl", `null\n5\n"s"\ntrue\n[1,2]\n{"n":6}\n`);

    const got = await collect(streamJsonlObjects(file));

    expect(got).toEqual([
      { record: [1, 2], lineNo: 5 },
      { record: { n: 6 }, lineNo: 6 },
    ]);
  });

  it("stamps the physical line, not the record index", async () => {
    const file = await fixture("blanks.jsonl", `\n\n{"n":1}\n\n{"n":2}\n`);

    const got = await collect(streamJsonlObjects(file));

    expect(got.map((item) => item.lineNo)).toEqual([3, 5]);
  });

  it("closes the interface and destroys the stream when the consumer breaks", async () => {
    const captured: { closed: number; stream?: { destroyed: boolean } } = { closed: 0 };
    vi.doMock("node:readline", async () => {
      const actual = await vi.importActual<typeof import("node:readline")>("node:readline");
      return {
        ...actual,
        createInterface: (opts: Parameters<typeof actual.createInterface>[0]) => {
          const rl = actual.createInterface(opts);
          const close = rl.close.bind(rl);
          rl.close = () => {
            captured.closed++;
            close();
          };
          return rl;
        },
      };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
          const stream = actual.createReadStream(...args);
          captured.stream = stream;
          return stream;
        },
      };
    });
    const file = await fixture("break.jsonl", `{"n":1}\n{"n":2}\n{"n":3}\n`);
    const mod = await import("./jsonlStream");

    for await (const _ of mod.streamJsonlObjects(file)) {
      break; // the shape both early-exit readers use
    }

    expect(captured.closed).toBe(1);
    expect(captured.stream?.destroyed).toBe(true);
  });
});

describe("streamJsonlLines", () => {
  it("yields blank and untrimmed lines verbatim", async () => {
    // What `readFirstLine` and `readFirstUserRecord` need: the parsed seam would
    // skip line 1 here and report line 2 as the first line of the file.
    const file = await fixture("raw.jsonl", `\n  {"n":1}  \n`);

    const got = await collect(streamJsonlLines(file));

    expect(got).toEqual([
      { line: "", lineNo: 1 },
      { line: `  {"n":1}  `, lineNo: 2 },
    ]);
  });

  it("rejects on an unreadable path instead of yielding nothing", async () => {
    // This is what lets each reader keep its own sentinel: swallowing the open
    // error here would make every caller report an empty file (OBL-3).
    await expect(collect(streamJsonlLines(path.join(dir, "absent.jsonl")))).rejects.toThrow();
    await expect(collect(streamJsonlLines(dir))).rejects.toThrow();
  });
});
