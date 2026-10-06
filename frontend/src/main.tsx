import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/figtree";
import { i18nReady } from "./lib/i18n";
import "./index.css";

// A chunk of an older release is gone after a deploy (open tab, lazy page or dialog): reload once
// to get the current index.html instead of failing on the import.
const RELOAD_KEY = "chunkReloadAt";
window.addEventListener("vite:preloadError", (event) => {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < 10_000) return; // reloaded just now: let the error surface
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// Render once the texts of the detected language are loaded (English is a lazy chunk).
void i18nReady
  .catch(() => undefined)
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
