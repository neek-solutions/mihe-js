import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@mihe-dev/protocol": fileURLToPath(
        new URL("./protocol/src/index.ts", import.meta.url),
      ),
      "@mihe-dev/js": fileURLToPath(new URL("./js/src/index.ts", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["js/tests/**/*.test.ts", "react/tests/**/*.test.ts?(x)"],
    setupFiles: ["react/tests/setup.ts"],
  },
});
