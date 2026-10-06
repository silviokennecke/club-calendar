// Reload guard for failed chunk loads (`vite:preloadError`, see main.tsx). After a deploy the
// chunks of the old release are gone; one reload fetches the current index.html. The guard allows
// that reload once per browser session and failed file; if the same file still fails afterwards the
// error surfaces (error page) instead of looping.

const STORAGE_KEY = "chunkReloads";
const MAX_ENTRIES = 20;

/** Identifies the failure: the URL of the file that could not be loaded (without the query). */
export function chunkErrorKey(payload: unknown): string {
  const message =
    payload !== null && typeof payload === "object"
      ? String((payload as { message?: unknown }).message ?? "")
      : String(payload ?? "");
  const url = /(?:https?:\/\/|\/)[^\s'"]+/.exec(message)?.[0] ?? message;
  return (url.split(/[?#]/)[0] || "unknown").slice(0, 200);
}

function parse(stored: string | null): Record<string, number> {
  if (!stored) return {};
  try {
    const value: unknown = JSON.parse(stored);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, at]) => typeof at === "number"),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Decides whether the failure `key` may trigger a reload and what to store: once per failed file
 * and session (the stored map holds the time of each reload).
 */
export function planChunkReload(
  stored: string | null,
  key: string,
  now: number,
): { reload: boolean; next: string } {
  const reloads = parse(stored);
  if (key in reloads) return { reload: false, next: JSON.stringify(reloads) };
  const entries = Object.entries({ ...reloads, [key]: now })
    .sort((a, b) => a[1] - b[1])
    .slice(-MAX_ENTRIES);
  return { reload: true, next: JSON.stringify(Object.fromEntries(entries)) };
}

interface ReloadDeps {
  storage?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
}

/**
 * Handler for `vite:preloadError`: reloads once per session and failed file. Returns true when it
 * reloads (the event is then cancelled so the failed import does not throw first). Without a usable
 * sessionStorage it never reloads (no way to prevent a loop).
 */
export function handlePreloadError(event: Event & { payload?: unknown }, deps: ReloadDeps = {}) {
  const { reload = () => window.location.reload(), now = Date.now } = deps;
  try {
    const storage = deps.storage ?? window.sessionStorage;
    const plan = planChunkReload(storage.getItem(STORAGE_KEY), chunkErrorKey(event.payload), now());
    if (!plan.reload) return false;
    storage.setItem(STORAGE_KEY, plan.next);
  } catch {
    return false;
  }
  event.preventDefault();
  reload();
  return true;
}

/**
 * After `preventDefault()` on `vite:preloadError` the preloading import resolves with `undefined`
 * instead of throwing, which `React.lazy` reports as "Cannot read properties of undefined". The page
 * is reloading at that point, so the import simply stays pending (the Suspense fallback shows).
 */
export function untilReload<M>(load: Promise<M>): Promise<M> {
  return load.then((module) => module ?? new Promise<never>(() => undefined));
}
