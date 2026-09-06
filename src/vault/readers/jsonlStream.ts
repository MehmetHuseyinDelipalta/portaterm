// src/vault/readers/jsonlStream.ts — the JSONL read lifecycle shared by the
// Claude and Codex vault readers (share-jsonl-stream-lifecycle D1).
//
// No `catch` here on purpose: readers answer an unreadable file differently —
// most `null`, `collectMemberTurns` its accumulated turns, `readFirstLine`
// `undefined` — so the open error must reach each caller (D5 OBL-3). Cleanup
// still runs on a caller's `break`, since `finally` in an async generator runs
// when `for await` calls `return()` (D5 OBL-2).

import { createReadStream } from "node:fs";
import * as readline from "node:readline";

/**
 * Every physical line, blanks included.
 *
 * `lineNo` is a 1-based physical position, not a record index: it counts blank
 * and corrupt lines too, because Codex stamps it onto records as a user-visible
 * transcript locator (D5 OBL-1).
 */
export async function* streamJsonlLines(filePath: string): AsyncGenerator<{ line: string; lineNo: number }> {
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    let lineNo = 0;
    for await (const line of rl) {
      lineNo += 1;
      yield { line, lineNo };
    }
  } finally {
    rl?.close();
    stream?.destroy();
  }
}

/**
 * Parsed non-null `typeof "object"` values, each with the physical line it came
 * from. Blank and corrupt lines are skipped but still counted.
 *
 * The predicate is exactly the one all six parsed call sites use today, so
 * **arrays are yielded** — `typeof [] === "object"`. Narrowing to plain objects
 * would change what those sites see (D5 OBL-5).
 *
 * `record` is therefore declared narrower than what it can hold: an array
 * reaches you typed as `Record<string, unknown>`. This is the same cast all six
 * sites made inline before the extraction, kept so the seam stays behaviour-
 * preserving — every caller here indexes by string key, which is safe on both
 * shapes. Do NOT assume string-keyed iteration or `Object.keys` semantics; if a
 * future consumer needs the distinction, widen the type and refine at the six
 * call sites as its own change (review round 1, F001).
 */
export async function* streamJsonlObjects(
  filePath: string,
): AsyncGenerator<{ record: Record<string, unknown>; lineNo: number }> {
  for await (const { line, lineNo } of streamJsonlLines(filePath)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // skip a single corrupt line, keep reading (D5 OBL-4)
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    yield { record: parsed as Record<string, unknown>, lineNo };
  }
}
