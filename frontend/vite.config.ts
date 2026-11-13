import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import docsPlugin from "./vite/docs-plugin";
import sonnerCss from "./vite/sonner-css";

// The SPA is served by the backend: build straight into backend/public, next to
// index.php and .htaccess (which must survive, so no emptyOutDir).
const outDir = path.resolve(__dirname, "../backend/public");

const cleanPreviousBuild: Plugin = {
  name: "clean-previous-build",
  apply: "build",
  buildStart() {
    fs.rmSync(path.join(outDir, "assets"), { recursive: true, force: true });
    fs.rmSync(path.join(outDir, "index.html"), { force: true });
  },
};

// Pristine copy of index.html next to the backend (not in public/): the backend renders the
// instance title from it (app:branding:apply-title, cache warmup).
const indexTemplate: Plugin = {
  name: "index-html-template",
  apply: "build",
  closeBundle() {
    const built = path.join(outDir, "index.html");
    if (fs.existsSync(built)) fs.copyFileSync(built, path.resolve(outDir, "../index.html.tpl"));
  },
};

export default defineConfig({
  plugins: [react(), docsPlugin(), sonnerCss(), cleanPreviousBuild, indexTemplate],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks (cached across app releases). Pages and dialogs are split per
        // route (src/pages/lazy.ts); mapbox-gl and emoji-mart stay in their own lazy chunks.
        manualChunks(id: string) {
          if (!id.includes("/node_modules/")) return undefined;
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)
          )
            return "vendor-react";
          if (id.includes("/node_modules/@tanstack/")) return "vendor-query";
          if (/\/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(id))
            return "vendor-i18n";
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Heavy jsdom renders (e.g. 230 import events) exceed the 5 s default on loaded machines/CI.
    testTimeout: 20000,
  },
});
