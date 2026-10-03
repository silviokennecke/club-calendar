import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// The SPA is served by the backend: build straight into backend/public, next to
// index.php and .htaccess (which must survive, so no emptyOutDir).
const outDir = path.resolve(__dirname, "../backend/public");

const cleanPreviousBuild = {
  name: "clean-previous-build",
  apply: "build" as const,
  buildStart() {
    fs.rmSync(path.join(outDir, "assets"), { recursive: true, force: true });
    fs.rmSync(path.join(outDir, "index.html"), { force: true });
  },
};

export default defineConfig({
  plugins: [react(), cleanPreviousBuild],
  build: { outDir, emptyOutDir: false },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
