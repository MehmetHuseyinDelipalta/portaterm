// src/pty/ShellIntegrationInjector.runtime.test.ts
// Runs the injector's bash argv/env through a real bash. The unit tests stub
// the filesystem and only snapshot argv; they cannot catch bash ignoring
// `--init-file` (which it does for login shells), so this proves the vendored
// script actually loads and that the login-profile imitation still happens.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { injectShellIntegration } from "./ShellIntegrationInjector";

const BASH = "/bin/bash";
const SCRIPTS_DIR = resolve(__dirname, "../../resources/shell-integration");
const directories: string[] = [];
const cleanups: Array<() => void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function runBash(args: string[], env: Record<string, string>, input: string): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(BASH, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.resume();
    child.once("error", reject);
    child.once("close", () => done(stdout));
    child.stdin.end(input);
  });
}

describe("ShellIntegrationInjector: real bash", () => {
  it.skipIf(process.platform === "win32" || !fs.existsSync(BASH)).each([
    { label: "--login (PtyManager default)", args: ["--login"], profile: "PROFILE_RAN" },
    { label: "no login flag", args: [], profile: "RC_RAN" },
    { label: "a combined -il cluster", args: ["-il"], profile: "PROFILE_RAN" },
  ])("loads the integration script with $label", async ({ args, profile }) => {
    const home = await mkdtemp(join(tmpdir(), "portaterm-bash-si-"));
    directories.push(home);
    await writeFile(join(home, ".bash_profile"), "echo PROFILE_RAN\n");
    await writeFile(join(home, ".bashrc"), "echo RC_RAN\n");

    const injection = injectShellIntegration(
      BASH,
      args,
      { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb" },
      { scriptsDir: SCRIPTS_DIR, tmpRoot: home, generateId: () => `id${Math.random().toString(36).slice(2)}`, fs },
    );
    expect(injection).not.toBeNull();
    cleanups.push(injection!.cleanup);

    // `-i` forces interactive mode without a TTY; a node-pty spawn gets that
    // from the terminal. `--init-file` is only honoured by interactive shells.
    // Prints `SI=` when the integration script never ran, `SI=1` when it did.
    const out = await runBash(
      [...injection!.args, "-i"],
      injection!.env,
      'echo "SI=$VSCODE_SHELL_INTEGRATION"\nexit\n',
    );

    expect(out).toContain("SI=1");
    expect(out).toContain(profile);
  });
});
