// src/vault/readers/readerErrorPaths.test.ts — characterization of the vault
// readers' error paths (share-jsonl-stream-lifecycle OBL-3/6/7/8).
//
// Written against the PRE-extraction readers: this file is the oracle the
// refactor must not move, so nothing here may be adjusted to fit a migration.
// Each case pairs the error path with the control that makes it non-vacuous —
// several reader sentinels answer the same on both branches and cannot witness
// anything, so only the branch-sensitive ones are asserted here.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFirstUserRecord, streamClaudeRecords } from "./claudeRecords";
import { readCodexSessions } from "./codexReader";

const MEMBER_ID = "11111111-2222-3333-4444-555555555555";

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-reader-errpaths-"));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
  vi.doUnmock("node:readline");
  vi.resetModules();
});

function userRecord(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-09-05T10:00:00.000Z",
    message: { role: "user", content: text },
    ...extra,
  });
}

describe("OBL-3: an unreadable file reaches the caller's own sentinel", () => {
  it("streamClaudeRecords answers null, not an empty record set", async () => {
    // A directory rejects at open. The control below is what makes this
    // branch-sensitive: a swallowed open error would answer like an empty file.
    expect(await streamClaudeRecords(dir)).toBeNull();
  });

  it("streamClaudeRecords answers an empty record set for a readable empty file", async () => {
    const file = path.join(dir, "empty.jsonl");
    await fsp.writeFile(file, "");

    expect(await streamClaudeRecords(file)).toEqual({ records: [], truncated: false });
  });

  it("collectMemberTurns keeps the turns accumulated before a mid-read failure", async () => {
    const boundary = (body: string) =>
      userRecord(`<teammate-message teammate_id="team-lead">${body}</teammate-message>`, {
        agentName: "alice",
        teamName: "squad",
      });
    // readline is the only injection point for a failure that happens *after*
    // lines have been delivered; an unreadable path fails at open and leaves
    // nothing accumulated, so it cannot tell `return turns` from `return []`.
    vi.doMock("node:readline", () => ({
      createInterface: () => ({
        close: () => {},
        async *[Symbol.asyncIterator]() {
          yield boundary("first");
          yield boundary("second");
          throw new Error("mid-read failure");
        },
      }),
    }));
    await fsp.writeFile(path.join(dir, `${MEMBER_ID}.jsonl`), "unused — readline is mocked\n");
    const { buildTeamThread } = await import("./claudeTeam");

    const items = await buildTeamThread(path.join(dir, "leader.jsonl"), new Set(["squad"]), new Map());

    expect(items.map((item) => (item as { preview: string }).preview)).toEqual(["first", "second"]);
  });
});

describe("OBL-6: a throwing onRecord costs one record, not the file", () => {
  it("keeps reading and still returns a result", async () => {
    const file = path.join(dir, "hook.jsonl");
    await fsp.writeFile(
      file,
      `${["a", "b", "c", "d"].map((t) => userRecord(t)).join("\n")}\n`,
    );
    const seen: string[] = [];
    let calls = 0;

    const result = await streamClaudeRecords(file, {
      onRecord: (rec) => {
        calls++;
        if (calls === 2) {
          throw new Error("hook blew up on record 2");
        }
        seen.push((rec.message as { content: string }).content);
      },
    });

    // The hook fires before the push, so the throw costs record 2 its buffer
    // slot as well — but only that record; the file is still read to the end.
    expect(seen).toEqual(["a", "c", "d"]);
    expect(result?.records.map((rec) => (rec.message as { content: string }).content)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });
});

describe("OBL-7: readFirstLine's raw seam, as production wires it", () => {
  it("lists no entry for a rollout whose first line is blank", async () => {
    // The parsed seam would skip the blank line and report line 2 as the
    // session_meta, keying the entry under a session the first line never named.
    const sessionsDir = path.join(dir, "sessions", "2026", "09", "05");
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(
      path.join(sessionsDir, "rollout-blank-head.jsonl"),
      `\n${JSON.stringify({ type: "session_meta", payload: { id: "leaked", cwd: "/repo" } })}\n`,
    );

    const { entries, unreadable } = await readCodexSessions({
      codexDir: dir,
      readSqliteFn: vi.fn(async () => ({ status: "no-db" as const, rows: [] })),
    });

    expect(entries).toEqual([]);
    expect(unreadable).toBe(1);
  });
});

describe("OBL-8: readFirstUserRecord stops on a literal null line", () => {
  it("answers null without reading past it", async () => {
    const file = path.join(dir, "null-head.jsonl");
    await fsp.writeFile(file, `null\n${userRecord("the title")}\n`);

    // `null` parses, then `obj.type` throws past the parse-only inner catch and
    // ends the read at the file-level catch. Latent bug, pinned so the refactor
    // cannot change it by accident.
    expect(await readFirstUserRecord(file)).toBeNull();
  });

  it("reads past other non-object lines, which merely fail the type filter", async () => {
    const file = path.join(dir, "array-head.jsonl");
    await fsp.writeFile(file, `[1,2]\n${userRecord("the title")}\n`);

    expect(await readFirstUserRecord(file)).toEqual({
      text: "the title",
      timestamp: Date.parse("2026-09-05T10:00:00.000Z"),
    });
  });
});
