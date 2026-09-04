import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createHeldRegularFilePool } from "./heldRegularFile";
import { openRegularFile } from "./regularFileRead";

const roots: string[] = [];
const unlinkable = process.platform === "win32" ? it.skip : it;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function file(contents = "before"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "held-file-"));
  roots.push(root);
  const target = path.join(root, "source");
  await fs.writeFile(target, contents);
  return target;
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition did not settle");
}

async function readSource(source: { stream: NodeJS.ReadableStream; finishWhen(work: Promise<unknown>): void }) {
  let text = "";
  const work = pipeline(
    source.stream,
    new Writable({
      write(chunk, _encoding, done) {
        text += chunk.toString();
        done();
      },
    }),
  );
  source.finishWhen(work);
  await work;
  return text;
}

describe("HeldRegularFilePool", () => {
  it("refuses before opening when no-follow is unavailable", async () => {
    let opens = 0;
    const pool = createHeldRegularFilePool({
      constants: { O_RDONLY: 1, O_NONBLOCK: 2, O_NOFOLLOW: 0 },
      openRegularFile: async (...args) => {
        opens += 1;
        return openRegularFile(...args);
      },
    });
    const reservation = pool.reserve();

    expect(await reservation?.hold("/repo/.env")).toBeUndefined();
    expect(opens).toBe(0);
    expect(pool.charged).toBe(0);
  });

  it("reserves all 64 lifecycle slots before any filesystem work begins", () => {
    const pool = createHeldRegularFilePool();
    const reservations = Array.from({ length: 64 }, () => pool.reserve());

    expect(reservations.every(Boolean)).toBe(true);
    expect(pool.reserve()).toBeUndefined();
    expect(pool.charged).toBe(64);

    for (const reservation of reservations) {
      reservation?.abandon();
    }
    expect(pool.charged).toBe(0);
  });

  it("keeps an abandoned pending admission charged and closes its late handle", async () => {
    const target = await file();
    const opened = await openRegularFile(target, undefined, { noFollow: true });
    const answer = deferred<typeof opened>();
    const pool = createHeldRegularFilePool({ max: 1, openRegularFile: () => answer.promise });
    const reservation = pool.reserve();
    const holding = reservation?.hold(target);

    reservation?.abandon();
    expect(pool.reserve()).toBeUndefined();
    expect(pool.charged).toBe(1);

    answer.resolve(opened);
    expect(await holding).toBeUndefined();
    await until(() => pool.charged === 0);
  });

  it("keeps a holder whose kernel close has not settled charged", async () => {
    const close = deferred<void>();
    const handle = {
      close: () => close.promise,
      stat: async () => ({ isFile: () => true, mode: 0o100640, size: 7 }),
    };
    const pool = createHeldRegularFilePool({
      max: 1,
      constants: { O_RDONLY: 1, O_NOFOLLOW: 2 },
      openRegularFile: async (_filePath, _openFile, options) => {
        options?.onOpen?.(handle as never);
        return handle as never;
      },
    });
    const held = await pool.reserve()?.hold("/repo/.env");

    held?.dispose();
    expect(pool.charged).toBe(1);
    expect(pool.reserve()).toBeUndefined();

    close.resolve();
    await until(() => pool.charged === 0);
  });

  it("closes a handle observed before admission stalls but keeps the pending work charged", async () => {
    let closes = 0;
    const handle = {
      close: async () => {
        closes += 1;
      },
    };
    const pool = createHeldRegularFilePool({
      max: 1,
      constants: { O_RDONLY: 1, O_NOFOLLOW: 2 },
      openRegularFile: async (_filePath, _openFile, options) => {
        options?.onOpen?.(handle as never);
        return new Promise(() => undefined);
      },
    });
    const reservation = pool.reserve();
    void reservation?.hold("/repo/.env");

    reservation?.abandon();
    await until(() => closes === 1);

    expect(pool.charged).toBe(1);
    expect(pool.reserve()).toBeUndefined();
  });

  it("keeps a never-settling abandoned admission inside the ceiling without blocking disposal", async () => {
    const pool = createHeldRegularFilePool({ max: 1, openRegularFile: () => new Promise(() => undefined) });
    const reservation = pool.reserve();
    void reservation?.hold("/repo/.env");
    reservation?.abandon();

    pool.dispose();

    expect(pool.charged).toBe(1);
    expect(pool.reserve()).toBeUndefined();
  });

  it("refuses a final symlink rather than holding its target", async () => {
    const target = await file("secret");
    const link = `${target}-link`;
    await fs.symlink(target, link);
    const pool = createHeldRegularFilePool();
    const reservation = pool.reserve();

    expect(await reservation?.hold(link)).toBeUndefined();
    await until(() => pool.charged === 0);
  });

  it("reads the held object after its pathname is replaced", async () => {
    const target = await file("selected");
    const moved = `${target}-moved`;
    const pool = createHeldRegularFilePool();
    const held = await pool.reserve()?.hold(target);
    await fs.rename(target, moved);
    await fs.writeFile(target, "replacement");

    const claim = held?.claim();
    const source = claim?.acquireSource();
    expect(source).toBeDefined();
    expect(source && (await readSource(source))).toBe("selected");
    claim?.dispose();
    await until(() => pool.charged === 0);
  });

  unlinkable("reads the held object after its only pathname is unlinked", async () => {
    const target = await file("unlinked");
    const pool = createHeldRegularFilePool();
    const held = await pool.reserve()?.hold(target);
    await fs.unlink(target);

    const source = held?.claim()?.acquireSource();
    expect(source && (await readSource(source))).toBe("unlinked");
    await until(() => pool.charged === 0);
  });

  it("starts at offset zero and observes in-place edits made before acquisition", async () => {
    const target = await file("first");
    const pool = createHeldRegularFilePool();
    const held = await pool.reserve()?.hold(target);
    await fs.writeFile(target, "second");

    const claim = held?.claim();
    expect(held?.claim()).toBeUndefined();
    const source = claim?.acquireSource();
    expect(claim?.acquireSource()).toBeUndefined();
    expect(source).toMatchObject({ mode: expect.any(Number), size: 5 });
    expect(source && (await readSource(source))).toBe("second");
    await until(() => pool.charged === 0);
  });

  it("makes disposal win a race with source acquisition", async () => {
    const target = await file();
    const pool = createHeldRegularFilePool();
    const claim = (await pool.reserve()?.hold(target))?.claim();

    claim?.dispose();

    expect(claim?.acquireSource()).toBeUndefined();
    await until(() => pool.charged === 0);
  });

  it("keeps the lifecycle slot charged until the registered pipeline settles", async () => {
    const target = await file("done");
    const pool = createHeldRegularFilePool();
    const held = await pool.reserve()?.hold(target);
    const source = held?.claim()?.acquireSource();
    const teardown = deferred<void>();
    source?.finishWhen(teardown.promise);
    source?.stream.resume();
    await new Promise<void>((resolve) => source?.stream.once("close", resolve));

    expect(pool.charged).toBe(1);
    teardown.resolve();
    await until(() => pool.charged === 0);
  });

  it("does not reuse a slot whose registered pipeline never settles", async () => {
    const target = await file("done");
    const pool = createHeldRegularFilePool({ max: 1 });
    const source = (await pool.reserve()?.hold(target))?.claim()?.acquireSource();
    source?.finishWhen(new Promise(() => undefined));
    source?.stream.resume();
    await new Promise<void>((resolve) => source?.stream.once("close", resolve));

    pool.dispose();

    expect(pool.charged).toBe(1);
    expect(pool.reserve()).toBeUndefined();
  });

  it("destroys an acquired source on disposal and releases once", async () => {
    const target = await file();
    const pool = createHeldRegularFilePool();
    const held = await pool.reserve()?.hold(target);
    const claim = held?.claim();
    const source = claim?.acquireSource();

    source?.dispose();
    source?.dispose();
    claim?.dispose();
    held?.dispose();
    pool.dispose();

    await until(() => pool.charged === 0);
  });

  it("disposes every unclaimed holder in the pool", async () => {
    const one = await file("one");
    const two = await file("two");
    const pool = createHeldRegularFilePool();
    await pool.reserve()?.hold(one);
    await pool.reserve()?.hold(two);
    expect(pool.charged).toBe(2);

    pool.dispose();

    await until(() => pool.charged === 0);
    expect(pool.reserve()).toBeUndefined();
  });
});
