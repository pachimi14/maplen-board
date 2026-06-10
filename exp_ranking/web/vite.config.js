import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Production: custom domain at site root (https://lulumi-tools.com/)
const pagesBase =
  process.env.GITHUB_PAGES === "true"
    ? process.env.PAGES_BASE_PATH || "/"
    : "/";

export default defineConfig({
  base: pagesBase,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
