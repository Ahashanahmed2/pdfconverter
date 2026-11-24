import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    minify: false,          // debug-এ সাহায্য করে
    sourcemap: true         // error trace-এ সাহায্য করে
  },
  server: {
    port: 1420,
    strictPort: true
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"]
});
