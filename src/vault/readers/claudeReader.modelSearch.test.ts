// src/vault/readers/claudeReader.modelSearch.test.ts — a list entry's model is
// looked for within MODEL_SEARCH_RECORDS records of the first prompt, so a
// session cancelled before any reply is not read to its end (perf B8).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_SEARCH_RECORDS, readClaudeSessions } from "./claudeReader";

const seen = vi.hoisted(() => ({ records: 0 }));

vi.mock("./jsonlStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jsonlStream")>();
  return {
    ...actual,
    streamJsonlObjects: async function* (...args: unknown[]) {
      for await (const item of (actual.streamJsonlObjects as (...a: unknown[]) => AsyncIterable<unknown>)(...args)) {
        seen.records++;
        yield item;
      }
    },
  };
});

let configDir: string;

const prompt = JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, cwd: "/w" });
const filler = JSON.stringify({ type: "progress", data: { step: 1 } });
const reply = JSON.stringify({ type: "assistant", message: { role: "assistant", model: "claude-x", content: [] } });

async function session(lines: string[]): Promise<void> {
  const file = path.join(configDir, "projects", "-w", "s.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${lines.join("\n")}\n`);
}

const model = async () => (await readClaudeSessions({ configDir })).entries[0]?.flags.model;

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-model-search-"));
  seen.records = 0;
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("the model search after the first prompt", () => {
  it("finds a reply that is the last record it looks at", async () => {
    await session([prompt, ...Array(MODEL_SEARCH_RECORDS - 1).fill(filler), reply]);
    expect(await model()).toBe("claude-x");
  });

  it("gives up one record later, still listing the session by its prompt", async () => {
    await session([prompt, ...Array(MODEL_SEARCH_RECORDS).fill(filler), reply]);
    const { entries } = await readClaudeSessions({ configDir });
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("hello");
    expect(entries[0].flags.model).toBeUndefined();
  });

  it("does not read a cancelled session to its end", async () => {
    await session([prompt, ...Array(5000).fill(filler)]);
    await readClaudeSessions({ configDir });
    expect(seen.records).toBe(MODEL_SEARCH_RECORDS + 1);
  });

  it("does not count the records before the first prompt", async () => {
    await session([...Array(MODEL_SEARCH_RECORDS + 50).fill(filler), prompt, filler, reply]);
    expect(await model()).toBe("claude-x");
  });

  it("looks 200 records past the prompt", () => {
    expect(MODEL_SEARCH_RECORDS).toBe(200);
  });
});
