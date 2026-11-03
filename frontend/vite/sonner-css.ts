import type { Plugin } from "vite";

/**
 * sonner injects its stylesheet as an inline <style> element at import time, which the CSP
 * (`style-src 'self'`) blocks. The build neutralises that injection; the same CSS ships as a real file
 * through `import "sonner/dist/styles.css"` (components/ui/shared/Toast.tsx). Fails loudly when a sonner
 * upgrade changes the injection code, instead of silently shipping a blocked <style>.
 */
const CALL = /__insertCSS\("(?:[^"\\]|\\.)*"\);?/;

export default function sonnerCss(): Plugin {
  let patched = false;
  return {
    name: "sonner-external-css",
    apply: "build",
    transform(code, id) {
      if (!/\/node_modules\/sonner\/dist\/index\.mjs$/.test(id.split("?")[0])) return null;
      if (!CALL.test(code)) {
        this.error("sonner: the CSS injector was not found, update vite/sonner-css.ts");
      }
      patched = true;
      return { code: code.replace(CALL, ""), map: null };
    },
    buildEnd() {
      if (!patched)
        this.error("sonner: dist/index.mjs was never transformed (CSP would block its <style>)");
    },
  };
}
