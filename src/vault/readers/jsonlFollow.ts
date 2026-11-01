// src/vault/readers/jsonlFollow.ts — Read an append-only JSONL transcript
// incrementally: the bytes a previous read already consumed are not read or
// parsed again.
//
// A followed session is re-read on every write the agent makes (~400 ms apart),
// and a transcript of tens of MB was parsed from byte 0 each time. The readers'
// per-read state — the bounded head+tail record buffer and their whole-stream
// side collectors — only ever folds records in, so it can be kept and fed just
// the lines appended since. A file that is not provably the same file grown
// (another inode, shorter than what was consumed, or different bytes where the
// last read stopped) is read from the start instead, into fresh state.
//
// Line semantics match `streamJsonlObjects`: lines split on LF (a CR before it is
// trimmed with the rest of the whitespace), blank and corrupt lines are skipped
// but counted, and only non-null objects are yielded. One deliberate difference
// in WHEN a line is consumed: an unterminated last line is consumed only if it
// parses — a line the agent is still writing is left for the next read, rather
// than skipped as corrupt and never seen again.

import * as fs from "node:fs/promises";

type Rec = Record<string, unknown>;

/** Bytes per read. Large enough that a fresh read of a big file is few syscalls. */
const CHUNK_BYTES = 1024 * 1024;
/** Bytes before the consumption point compared on reuse, to catch a rewrite. */
const BOUNDARY_BYTES = 64;
/** Followed transcripts kept. Each holds what one detail read already holds. */
const DEFAULT_MAX_ENTRIES = 4;

/** Just enough of `fs.open` for this module; injectable for tests. */
export type OpenFn = (filePath: string) => Promise<{
  stat(): Promise<{ dev: number; ino: number; size: number }>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}>;

interface Entry {
  dev: number;
  ino: number;
  /** Bytes consumed — always the end of a line that was handed to `feed`. */
  offset: number;
  /** Physical lines consumed. */
  lineNo: number;
  /** The `BOUNDARY_BYTES` (or fewer) before `offset`, as last read. */
  boundary: Buffer;
  /**
   * The last consumed line had no LF yet. Its LF, when it arrives, ends that
   * line rather than counting as a blank one; anything else appended to it
   * means the line was not what was consumed, and the file is read afresh.
   */
  unterminated: boolean;
  state: unknown;
}

export interface JsonlFollowCache {
  /**
   * Feed every record of `filePath` not yet fed into the state kept under `key`
   * (fresh from `init` when there is none, or it no longer describes this file),
   * then return `finish(state)`. `finish` runs before any other read of the same
   * key can feed more, so what it returns is one consistent moment of the file —
   * it must copy anything the caller keeps that a later feed would mutate.
   *
   * `null` when the file could not be read; the kept state is discarded then.
   * A `feed` that throws costs that one record, never the file.
   */
  read<S, R>(
    key: string,
    filePath: string,
    init: () => S,
    feed: (state: S, record: Rec, lineNo: number) => void,
    finish: (state: S) => R,
  ): Promise<R | null>;
  /** Forget every kept state (tests, and nothing else needs it). */
  clear(): void;
  readonly size: number;
}

export function createJsonlFollowCache(
  options: { maxEntries?: number; open?: OpenFn; chunkBytes?: number } = {},
): JsonlFollowCache {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const open: OpenFn = options.open ?? ((p) => fs.open(p, "r"));
  const chunkBytes = Math.max(1, options.chunkBytes ?? CHUNK_BYTES);
  const entries = new Map<string, Entry>();
  /** Reads of one key run one at a time: two at once would feed the same lines twice. */
  const queues = new Map<string, Promise<unknown>>();

  function remember(key: string, entry: Entry): void {
    entries.delete(key); // re-insert: Map order is the LRU order
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }
  }

  async function readBytes(handle: Awaited<ReturnType<OpenFn>>, position: number, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
      if (bytesRead === 0) {
        break;
      }
      filled += bytesRead;
    }
    return filled === length ? buffer : buffer.subarray(0, filled);
  }

  async function reusable(
    handle: Awaited<ReturnType<OpenFn>>,
    entry: Entry,
    stat: { dev: number; ino: number; size: number },
  ) {
    // (A file shorter than what was consumed would also fail the boundary
    // comparison below; this only spares it the read.)
    if (entry.dev !== stat.dev || entry.ino !== stat.ino || stat.size < entry.offset) {
      return false;
    }
    const start = entry.offset - entry.boundary.length;
    const now = await readBytes(handle, start, entry.boundary.length);
    if (!now.equals(entry.boundary)) {
      return false;
    }
    if (entry.unterminated && stat.size > entry.offset) {
      const next = await readBytes(handle, entry.offset, 1);
      if (next[0] !== 0x0a) {
        return false;
      }
      entry.offset += 1;
      entry.unterminated = false;
    }
    return true;
  }

  function parseObject(bytes: Buffer): Rec | undefined {
    const trimmed = bytes.toString("utf8").trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? (parsed as Rec) : undefined;
    } catch {
      return undefined;
    }
  }

  async function readOnce<S, R>(
    key: string,
    filePath: string,
    init: () => S,
    feed: (state: S, record: Rec, lineNo: number) => void,
    finish: (state: S) => R,
  ): Promise<R | null> {
    let handle: Awaited<ReturnType<OpenFn>> | undefined;
    try {
      handle = await open(filePath);
      const stat = await handle.stat();
      const kept = entries.get(key);
      const entry: Entry =
        kept && (await reusable(handle, kept, stat))
          ? kept
          : {
              dev: stat.dev,
              ino: stat.ino,
              offset: 0,
              lineNo: 0,
              boundary: Buffer.alloc(0),
              unterminated: false,
              state: init(),
            };
      const state = entry.state as S;
      const deliver = (record: Rec): void => {
        try {
          feed(state, record, entry.lineNo);
        } catch {
          // a throwing feed costs this record only
        }
      };

      let position = entry.offset;
      let pending: Buffer[] = []; // bytes of the line being assembled, not yet terminated
      while (position < stat.size) {
        const chunk = await readBytes(handle, position, Math.min(chunkBytes, stat.size - position));
        if (chunk.length === 0) {
          break; // the file shrank under us; what was consumed stands
        }
        let lineStart = 0;
        let newline = chunk.indexOf(0x0a, lineStart);
        while (newline !== -1) {
          const tail = chunk.subarray(lineStart, newline);
          const line = pending.length > 0 ? Buffer.concat([...pending, tail]) : tail;
          pending = [];
          entry.lineNo += 1;
          entry.offset = position + newline + 1;
          const record = parseObject(line);
          if (record) {
            deliver(record);
          }
          lineStart = newline + 1;
          newline = chunk.indexOf(0x0a, lineStart);
        }
        if (lineStart < chunk.length) {
          pending.push(chunk.subarray(lineStart));
        }
        position += chunk.length;
      }
      if (pending.length > 0) {
        // An unterminated last line: consumed only when it is already a whole record.
        const record = parseObject(Buffer.concat(pending));
        if (record) {
          entry.lineNo += 1;
          entry.offset = position;
          entry.unterminated = true;
          deliver(record);
        }
      }
      const boundaryLength = Math.min(BOUNDARY_BYTES, entry.offset);
      entry.boundary = await readBytes(handle, entry.offset - boundaryLength, boundaryLength);
      const result = finish(state);
      remember(key, entry);
      return result;
    } catch {
      // A failure part-way leaves a half-fed state: the next read starts over.
      entries.delete(key);
      return null;
    } finally {
      try {
        await handle?.close();
      } catch {
        // nothing to do: the read already answered
      }
    }
  }

  return {
    read(key, filePath, init, feed, finish) {
      const previous = queues.get(key) ?? Promise.resolve();
      const run = previous.then(() => readOnce(key, filePath, init, feed, finish));
      const settled = run.catch(() => undefined);
      queues.set(key, settled);
      void settled.then(() => {
        if (queues.get(key) === settled) {
          queues.delete(key);
        }
      });
      return run;
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** The process-wide cache the detail readers share. */
export const jsonlFollowCache = createJsonlFollowCache();
