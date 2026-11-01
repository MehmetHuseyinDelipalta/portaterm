// src/session/MirrorWrites.ts — The writes to one headless mirror that have not
// been parsed yet, and the flushes waiting for them.
//
// xterm.js parses `write(data, cb)` asynchronously, so a snapshot must wait for
// every write issued before it to be parsed. That used to be one Promise and one
// `.then` per PTY chunk, chained per session — thousands a second from an agent's
// TUI. Here a write costs two counters and one shared callback: xterm calls a
// mirror's write callbacks in the order of the writes, so "parsed" counts how far
// it has got, and a flush waits until it reaches what "issued" was when the flush
// asked. Writes made after that do not hold the flush up.

/** The part of a headless terminal this needs. */
export interface ParsingMirror {
  write(data: string, callback?: () => void): void;
}

export class MirrorWrites {
  private issued = 0;
  private parsed = 0;
  private waiters: Array<{ upTo: number; resolve: () => void }> = [];
  private readonly onParsed = (): void => {
    this.parsed++;
    if (this.waiters.length > 0) {
      this.wake();
    }
  };

  /** Write `data` to `mirror`; a write that throws was never queued, and `onError` hears of it. */
  write(mirror: ParsingMirror, data: string, onError: (err: unknown) => void): void {
    this.issued++;
    try {
      mirror.write(data, this.onParsed);
    } catch (err) {
      this.issued--;
      onError(err);
    }
  }

  /** Resolves once every write issued so far has been parsed. Never rejects. */
  settled(): Promise<void> {
    if (this.parsed >= this.issued) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push({ upTo: this.issued, resolve }));
  }

  /** The mirror is gone, and its callbacks may never come: nobody waits any longer. */
  release(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const waiter of waiting) {
      waiter.resolve();
    }
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const waiter of waiting) {
      if (this.parsed >= waiter.upTo) {
        waiter.resolve();
      } else {
        this.waiters.push(waiter);
      }
    }
  }
}
