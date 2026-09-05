import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { Readable } from "node:stream";
import { type Constants, type OpenLike, type OpenRegularFileOptions, openRegularFile } from "./regularFileRead";

export const MAX_HELD_REGULAR_FILES = 64;

export interface HeldFileReservation {
  hold(filePath: string): Promise<HeldRegularFile | undefined>;
  abandon(): void;
}

export interface HeldRegularFile {
  claim(): ClaimedRegularFile | undefined;
  dispose(): void;
}

export interface ClaimedRegularFile {
  acquireSource(): HeldFileSource | undefined;
  dispose(): void;
}

export interface HeldFileSource {
  readonly stream: Readable;
  readonly mode: number;
  readonly size: number;
  finishWhen(actualPipeline: Promise<unknown>): void;
  dispose(error?: Error): void;
}

export interface HeldRegularFilePool {
  readonly charged: number;
  reserve(): HeldFileReservation | undefined;
  dispose(): void;
}

type OpenRegularFileLike = (
  filePath: string,
  openFile?: OpenLike,
  options?: OpenRegularFileOptions,
) => Promise<FileHandle>;

export interface HeldRegularFilePoolOptions {
  /** Test seam; values above the production ceiling are clamped to 64. */
  readonly max?: number;
  readonly constants?: Constants;
  readonly openFile?: OpenLike;
  readonly openRegularFile?: OpenRegularFileLike;
  readonly lstatFile?: OpenRegularFileOptions["lstatFile"];
}

type SlotState = "reserved" | "opening" | "held" | "claimed" | "source" | "closing" | "released";

class Pool implements HeldRegularFilePool {
  readonly slots = new Set<Slot>();
  readonly max: number;
  disposed = false;

  constructor(readonly options: HeldRegularFilePoolOptions) {
    const requested = options.max ?? MAX_HELD_REGULAR_FILES;
    this.max = Number.isFinite(requested) ? Math.max(0, Math.min(MAX_HELD_REGULAR_FILES, Math.floor(requested))) : 0;
  }

  get charged(): number {
    return this.slots.size;
  }

  reserve(): HeldFileReservation | undefined {
    if (this.disposed || this.slots.size >= this.max) {
      return undefined;
    }
    const slot = new Slot(this, this.options);
    this.slots.add(slot);
    return slot.reservation;
  }

  release(slot: Slot): void {
    this.slots.delete(slot);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const slot of this.slots) {
      slot.disposeAll();
    }
  }
}

class Slot {
  state: SlotState = "reserved";
  abandoned = false;
  admissionDone = true;
  handle: FileHandle | undefined;
  closeStarted = false;
  closeDone = false;
  mode = 0;
  size = 0;
  stream: Readable | undefined;
  streamHandle: FileHandle | undefined;
  streamClosed = false;
  pipelineRegistered = false;
  pipelineDone = false;

  readonly reservation: HeldFileReservation = {
    hold: (filePath) => this.hold(filePath),
    abandon: () => this.abandonAdmission(),
  };

  readonly holder: HeldRegularFile = {
    claim: () => this.claim(),
    dispose: () => this.disposeHolder(),
  };

  readonly claimOwner: ClaimedRegularFile = {
    acquireSource: () => this.acquireSource(),
    dispose: () => this.disposeClaim(),
  };

  constructor(
    readonly pool: Pool,
    readonly options: HeldRegularFilePoolOptions,
  ) {}

  async hold(filePath: string): Promise<HeldRegularFile | undefined> {
    if (this.state !== "reserved") {
      return undefined;
    }
    const platform = this.options.constants ?? constants;
    if (typeof platform.O_NOFOLLOW !== "number" || platform.O_NOFOLLOW === 0) {
      this.release();
      return undefined;
    }

    this.state = "opening";
    this.admissionDone = false;
    let delivered = false;
    try {
      const open = this.options.openRegularFile ?? openRegularFile;
      const handle = await open(filePath, this.options.openFile, {
        noFollow: true,
        constants: platform,
        lstatFile: this.options.lstatFile,
        onOpen: (opened) => {
          this.handle = opened;
          if (this.abandoned) {
            this.requestHandleClose();
          }
        },
      });
      this.handle = handle;
      if (this.abandoned) {
        return undefined;
      }

      const stat = await handle.stat();
      if (this.abandoned || !stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) {
        return undefined;
      }
      this.mode = stat.mode;
      this.size = stat.size;
      this.state = "held";
      delivered = true;
      return this.holder;
    } catch {
      return undefined;
    } finally {
      this.admissionDone = true;
      if (!delivered) {
        this.state = "closing";
        this.requestHandleClose();
        this.releaseClosedHandle();
      }
    }
  }

  abandonAdmission(): void {
    if (this.state === "reserved") {
      this.abandoned = true;
      this.release();
      return;
    }
    if (this.state === "opening") {
      this.abandoned = true;
      this.requestHandleClose();
      return;
    }
    if (this.state === "held") {
      this.abandoned = true;
      this.disposeHolder();
    }
  }

  disposeAll(): void {
    if (this.state === "released") {
      return;
    }
    this.abandoned = true;
    if (this.state === "reserved") {
      this.release();
      return;
    }
    if (this.state === "opening") {
      this.requestHandleClose();
      return;
    }
    if (this.state === "source") {
      this.disposeSource();
      return;
    }
    this.state = "closing";
    this.requestHandleClose();
    this.releaseClosedHandle();
  }

  claim(): ClaimedRegularFile | undefined {
    if (this.state !== "held") {
      return undefined;
    }
    this.state = "claimed";
    return this.claimOwner;
  }

  disposeHolder(): void {
    if (this.state !== "held") {
      return;
    }
    this.state = "closing";
    this.requestHandleClose();
  }

  disposeClaim(): void {
    if (this.state === "claimed") {
      this.state = "closing";
      this.requestHandleClose();
      return;
    }
    if (this.state === "source") {
      this.disposeSource();
    }
  }

  acquireSource(): HeldFileSource | undefined {
    if (this.state !== "claimed" || !this.handle) {
      return undefined;
    }
    let stream: Readable;
    try {
      stream = this.handle.createReadStream({ start: 0, autoClose: true });
    } catch {
      this.state = "closing";
      this.requestHandleClose();
      return undefined;
    }

    this.streamHandle = this.handle;
    this.handle = undefined;
    this.state = "source";
    this.stream = stream;
    stream.on("error", () => {});
    stream.once("close", () => {
      // Node can emit `close` even when FileHandle.close() rejected. The fd
      // transition is the positive witness that the stream-owned descriptor
      // actually closed; ambiguity keeps the lifecycle slot charged.
      this.streamClosed = this.streamHandle?.fd === -1;
      this.releaseFinishedSource();
    });

    return {
      stream,
      mode: this.mode,
      size: this.size,
      finishWhen: (actualPipeline) => this.finishWhen(actualPipeline),
      dispose: (error) => this.disposeSource(error),
    };
  }

  finishWhen(actualPipeline: Promise<unknown>): void {
    if (this.state !== "source" || this.pipelineRegistered) {
      return;
    }
    this.pipelineRegistered = true;
    void actualPipeline.then(
      () => {
        this.pipelineDone = true;
        this.releaseFinishedSource();
      },
      () => {
        this.pipelineDone = true;
        this.releaseFinishedSource();
      },
    );
  }

  disposeSource(error?: Error): void {
    if (this.state !== "source") {
      return;
    }
    if (!this.pipelineRegistered) {
      this.pipelineDone = true;
    }
    this.stream?.destroy(error);
    this.releaseFinishedSource();
  }

  requestHandleClose(): void {
    if (!this.handle || this.closeStarted) {
      this.releaseClosedHandle();
      return;
    }
    this.closeStarted = true;
    void this.handle.close().then(
      () => {
        this.closeDone = true;
        this.releaseClosedHandle();
      },
      () => {
        // A rejected close does not prove the descriptor was released. Keep the
        // slot charged rather than allowing an unbounded sequence of retries.
      },
    );
  }

  releaseClosedHandle(): void {
    if (this.state !== "closing" || !this.admissionDone) {
      return;
    }
    if (this.handle && !this.closeDone) {
      return;
    }
    this.release();
  }

  releaseFinishedSource(): void {
    if (this.state !== "source" || !this.streamClosed || !this.pipelineDone) {
      return;
    }
    this.release();
  }

  release(): void {
    if (this.state === "released") {
      return;
    }
    this.state = "released";
    this.streamHandle = undefined;
    this.pool.release(this);
  }
}

export function createHeldRegularFilePool(options: HeldRegularFilePoolOptions = {}): HeldRegularFilePool {
  return new Pool(options);
}
