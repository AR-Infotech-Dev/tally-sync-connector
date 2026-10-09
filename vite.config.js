import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "src/renderer"),
  plugins: [react()],
  base: "./",
  resolve: { preserveSymlinks: true },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: path.join(root, "dist/renderer"), emptyOutDir: true },
});
