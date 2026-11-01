// src/session/ScrollbackCache.ts — A session's recent output, kept so a view that
// attaches again can be repainted, bounded in characters with the oldest output
// dropped first.
//
// An agent's TUI writes a great many tiny chunks — a spinner frame, a cursor
// move — so an array of raw chunks grew to tens of thousands of elements, and
// once full it ran `Array.shift()` (a copy of the whole array) on every chunk.
// Here small chunks are joined into pieces of up to `COALESCE_CHARS`, and the
// oldest are dropped by moving a head index; the array is compacted only once
// the dropped part outweighs the live one, so each append costs O(1) amortized.

/** Chunks are joined until a piece would pass this many characters. */
export const COALESCE_CHARS = 4096;

export class ScrollbackCache {
  private pieces: string[] = [];
  /** Index of the oldest piece still kept; those before it are dropped. */
  private head = 0;
  private total = 0;

  constructor(private readonly maxChars: number) {}

  /** Characters kept. */
  get size(): number {
    return this.total;
  }

  /** Pieces held, kept or awaiting compaction — for tests of the bound. */
  get pieceCount(): number {
    return this.pieces.length;
  }

  /**
   * Add output, then drop the oldest pieces while more than `maxChars` are kept —
   * whole pieces, so what remains starts where some earlier write started.
   */
  append(data: string): void {
    // The last piece is always kept: once every piece is dropped, compaction
    // below empties the array.
    const last = this.pieces.length - 1;
    if (last >= 0 && this.pieces[last].length + data.length <= COALESCE_CHARS) {
      this.pieces[last] += data;
    } else {
      this.pieces.push(data);
    }
    this.total += data.length;
    while (this.total > this.maxChars && this.head < this.pieces.length) {
      this.total -= this.pieces[this.head].length;
      this.head++;
    }
    if (this.head * 2 >= this.pieces.length) {
      this.pieces = this.pieces.slice(this.head);
      this.head = 0;
    }
  }

  /** Everything kept, oldest first. */
  text(): string {
    return this.pieces.slice(this.head).join("");
  }

  clear(): void {
    this.pieces = [];
    this.head = 0;
    this.total = 0;
  }
}
