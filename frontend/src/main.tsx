import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/figtree";
import { AppErrorBoundary } from "./components/error/ErrorPage";
import { handlePreloadError } from "./lib/chunkReload";
import { i18nReady } from "./lib/i18n";
import "./index.css";

// A chunk of an older release is gone after a deploy (open tab, lazy page or dialog): reload once
// per session and failed file to get the current index.html. If it still fails, the error page
// (components/error) takes over instead of a reload loop.
window.addEventListener("vite:preloadError", (event) => handlePreloadError(event));

// Render once the texts of the detected language are loaded (English is a lazy chunk).
void i18nReady
  .catch(() => undefined)
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  });
