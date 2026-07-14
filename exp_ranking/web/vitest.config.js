import { defineConfig } from "vitest/config";

// T3 derived-stats tests only. Kept separate from vite.config.js so the
// production build config (base path, Pages alias, plugins) stays untouched.
// stats/ modules use relative imports only (no "@/" alias dependency).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/stats/**/*.test.js"],
  },
});
