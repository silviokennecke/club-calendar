/** What went wrong, as far as the error page tells the user: see `components/error/ErrorPage.tsx`. */
export type ErrorKind = "notFound" | "load" | "generic";

// Messages of a failed dynamic import / preload per browser (Chromium, Firefox, Safari), Vite's CSS
// preload helper and webpack-style chunk errors.
const LOAD_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading (css )?chunk [\w-]+ failed|dynamically imported module/i;

/** The error is a chunk (dynamic import) that could not be loaded, typically after a deploy. */
export function isLoadError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && LOAD_ERROR_PATTERN.test(message);
}

/** A thrown route response (React Router `ErrorResponse`) or `Response`-like with a status. */
function statusOf(error: unknown): number | null {
  if (error === null || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** Sorts a router / render error into the three states of the error page. */
export function classifyError(error: unknown): ErrorKind {
  if (statusOf(error) === 404) return "notFound";
  if (isLoadError(error)) return "load";
  return "generic";
}
