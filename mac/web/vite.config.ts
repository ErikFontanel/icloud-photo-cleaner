import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the review page into the Python package, which serves it (sift_mac/server.py). `pnpm dev` proxies the API
// to a running `sift-mac review` (SIFT_PORT, default 8765).
const api = `http://127.0.0.1:${process.env.SIFT_PORT || 8765}`;
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  build: {
    outDir: "../sift_mac/web",
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), table: resolve(import.meta.dirname, "table.html") } },
  },
  server: { proxy: { "/api": api, "/thumb": api, "/preview": api } },
});
