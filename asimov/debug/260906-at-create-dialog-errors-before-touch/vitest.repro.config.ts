import { defineConfig } from "vitest/config";

// The repro lives outside `src`, so it needs its own include — the project config
// scopes vitest to the source tree.
export default defineConfig({
  test: {
    root: process.cwd(),
    include: ["asimov/debug/260906-at-create-dialog-errors-before-touch/*.test.ts"],
  },
});
