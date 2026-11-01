// The build ships Shiki as its own bundle (D3): `webview.js` carries none of it,
// and `shiki.js` publishes itself where syntaxRenderer looks for it. Built with
// the real esbuild targets, in memory.

import { createRequire } from "node:module";
import * as path from "node:path";
// The package by its typings' path: a bare "esbuild" resolves to the repo's own esbuild.js under baseUrl.
import type * as esbuild from "esbuild/lib/main";
import { describe, expect, it, vi } from "vitest";
import { SHIKI_GLOBAL } from "../webview/links/shikiGlobal";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "../..");
const esbuildApi = require(require.resolve("esbuild", { paths: [path.join(root, "node_modules")] })) as typeof esbuild;
const targets = require(path.join(root, "esbuild.js")) as {
  buildConfigs: esbuild.BuildOptions[];
  webviewConfig: esbuild.BuildOptions;
  shikiConfig: esbuild.BuildOptions;
  run(api: unknown, options: { watch: boolean }): Promise<void>;
};

async function buildInMemory(config: esbuild.BuildOptions): Promise<string> {
  const result = await esbuildApi.build({
    ...config,
    absWorkingDir: root,
    plugins: [], // the copy plugin writes into media/
    sourcemap: false,
    write: false,
    logLevel: "silent",
  });
  const js = result.outputFiles?.find((f) => f.path.endsWith(".js"));
  if (!js) {
    throw new Error("no JavaScript output");
  }
  return js.text;
}

describe("build targets", () => {
  it("builds and watches the Shiki bundle with every other target", () => {
    expect(targets.buildConfigs).toContain(targets.shikiConfig);
    expect(targets.buildConfigs).toContain(targets.webviewConfig);
    expect(targets.shikiConfig.entryPoints).toEqual(["./src/webview/links/shikiBundle.ts"]);
    expect(targets.shikiConfig.outfile).toBe("./media/shiki.js");
    // Beside webview.js, as an IIFE for the browser — where syntaxRenderer looks for it.
    expect(path.dirname(targets.shikiConfig.outfile ?? "")).toBe(path.dirname(targets.webviewConfig.outfile ?? ""));
    expect(targets.shikiConfig.format).toBe("iife");
    expect(targets.shikiConfig.platform).toBe("browser");
  });

  it.each([
    false,
    true,
  ])("hands the Shiki bundle to esbuild in a build and in watch mode (watch: %s)", async (watch) => {
    const given: esbuild.BuildOptions[] = [];
    const watched: esbuild.BuildOptions[] = [];
    const api = {
      build: async (config: esbuild.BuildOptions) => {
        given.push(config);
      },
      context: async (config: esbuild.BuildOptions) => {
        given.push(config);
        return { watch: async () => watched.push(config) };
      },
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await targets.run(api, { watch });
    } finally {
      log.mockRestore();
    }
    expect(given).toEqual(targets.buildConfigs);
    expect(given).toContain(targets.shikiConfig);
    expect(watched).toEqual(watch ? targets.buildConfigs : []);
  });

  it("keeps every grammar out of webview.js and puts them in shiki.js, which publishes itself", async () => {
    const [webview, shiki] = await Promise.all([
      buildInMemory(targets.webviewConfig),
      buildInMemory(targets.shikiConfig),
    ]);
    // A grammar's scope name is in its JSON; the webview bundle must hold none.
    for (const scope of ["source.ts", "source.python", "source.rust", "source.yaml"]) {
      expect(webview).not.toContain(`"scopeName":"${scope}"`);
      expect(webview).not.toContain(`scopeName: "${scope}"`);
      expect(shiki.includes(`"scopeName":"${scope}"`) || shiki.includes(`scopeName: "${scope}"`)).toBe(true);
    }
    expect(shiki).toContain(SHIKI_GLOBAL);
  }, 120_000);
});
