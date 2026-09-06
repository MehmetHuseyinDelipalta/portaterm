import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ["asimov/debug/260906-at-create-dialog-resolves-an-empty-name/repro.test.ts"],
  },
});
