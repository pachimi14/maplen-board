import { defineConfig } from "vitest/config";

// T3 derived-stats + T4a profile-store + T4b (my-character summary +
// #/group route, §22.4) pure-logic tests. Kept separate from vite.config.js
// so the production build config (base path, Pages alias, plugins) stays
// untouched. stats/, profile/, board/ and the components/*.test.js pure
// helpers below use relative imports only (no "@/" alias dependency).
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/stats/**/*.test.js",
      "src/profile/**/*.test.js",
      "src/components/**/*.test.js",
      "src/board/**/*.test.js",
    ],
  },
});
