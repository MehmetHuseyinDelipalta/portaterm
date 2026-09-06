import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ["asimov/debug/260906-at-create-dialog-blur-from-autofocus/repro.test.ts"],
  },
});
