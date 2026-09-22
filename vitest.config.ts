import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: rootDirectory,
      },
    ],
  },
  test: {
    include: [
      "tests/**/*.test.{ts,tsx}",
      "ui/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
