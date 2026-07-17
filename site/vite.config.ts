import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// Relative base ("./") keeps assets working at any URL — root user/org page,
// project page, or custom domain — without rebuilding. Override with VITE_BASE_PATH.
const base = process.env.VITE_BASE_PATH || "./";

export default defineConfig({
  base,
  root,
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
});
