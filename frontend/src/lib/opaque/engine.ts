import { runOpaque, type OpaqueCall } from "./core";
import { OpaqueClientError } from "./ksf";

// The WASM (~158 KB gz) is only fetched on first use. Runs in a Web Worker so the 64 MiB Argon2id
// does not freeze the UI; without Worker support (or when the worker fails to load) it runs on the
// main thread through the lazily imported module.
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; call: OpaqueCall };

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined") return worker;
  try {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error !== undefined) {
        p.reject(new OpaqueClientError("opaque_unsupported", e.data.error));
      } else p.resolve(e.data.result);
    };
    w.onerror = () => {
      // Worker could not start: finish everything on the main thread from now on.
      worker = null;
      w.terminate();
      const stuck = [...pending.values()];
      pending.clear();
      for (const p of stuck) mainThread(p.call).then(p.resolve, p.reject);
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

async function mainThread(call: OpaqueCall): Promise<unknown> {
  try {
    return await runOpaque(await import("@serenity-kit/opaque"), call);
  } catch (err) {
    throw new OpaqueClientError(
      "opaque_unsupported",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function callOpaque<T>(call: OpaqueCall): Promise<T> {
  const w = getWorker();
  if (!w) return mainThread(call) as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, call });
    w.postMessage({ id, call });
  });
}

/** Warms the chunk (e.g. on focus of the password field); never throws. */
export function prefetchOpaque(): void {
  if (!getWorker()) void import("@serenity-kit/opaque").catch(() => undefined);
}
