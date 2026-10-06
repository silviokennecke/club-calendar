import { describe, it, expect, vi } from "vitest";
import { chunkErrorKey, handlePreloadError, planChunkReload, untilReload } from "../chunkReload";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function preloadEvent(message: string) {
  const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
    payload?: unknown;
  };
  event.payload = new Error(message);
  return event;
}

describe("chunkErrorKey", () => {
  it("uses the URL of the failed file without query", () => {
    expect(
      chunkErrorKey(
        new Error(
          "Failed to fetch dynamically imported module: https://x.test/assets/CalendarPage-abc.js?t=1",
        ),
      ),
    ).toBe("https://x.test/assets/CalendarPage-abc.js");
    expect(chunkErrorKey(new Error("Unable to preload CSS for /assets/a-1.css"))).toBe(
      "/assets/a-1.css",
    );
  });

  it("falls back to the message and to 'unknown'", () => {
    expect(chunkErrorKey(new Error("boom"))).toBe("boom");
    expect(chunkErrorKey(undefined)).toBe("unknown");
  });
});

describe("planChunkReload", () => {
  it("allows the first reload of a failure and remembers it", () => {
    const plan = planChunkReload(null, "/assets/a.js", 1000);
    expect(plan.reload).toBe(true);
    expect(JSON.parse(plan.next)).toEqual({ "/assets/a.js": 1000 });
  });

  it("allows no second reload of the same failure, however much time passed", () => {
    const first = planChunkReload(null, "/assets/a.js", 1000);
    expect(planChunkReload(first.next, "/assets/a.js", 1001).reload).toBe(false);
    expect(planChunkReload(first.next, "/assets/a.js", 99_999_999).reload).toBe(false);
  });

  it("allows one reload for each different failure", () => {
    const first = planChunkReload(null, "/assets/a.js", 1000);
    const second = planChunkReload(first.next, "/assets/b.js", 2000);
    expect(second.reload).toBe(true);
    expect(Object.keys(JSON.parse(second.next))).toEqual(["/assets/a.js", "/assets/b.js"]);
  });

  it("treats corrupt storage content as empty and keeps the list short", () => {
    expect(planChunkReload("{not json", "k", 1).reload).toBe(true);
    expect(planChunkReload("[1,2]", "k", 1).reload).toBe(true);
    let stored: string | null = null;
    for (let i = 0; i < 30; i++) stored = planChunkReload(stored, `k${i}`, i).next;
    expect(Object.keys(JSON.parse(stored!))).toHaveLength(20);
  });
});

describe("handlePreloadError", () => {
  it("reloads once, cancels the event, and does not loop", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const first = preloadEvent("Failed to fetch dynamically imported module: /assets/P-1.js");
    expect(handlePreloadError(first, { storage, reload })).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // After the reload the same file fails again: the error surfaces.
    const again = preloadEvent("Failed to fetch dynamically imported module: /assets/P-1.js");
    expect(handlePreloadError(again, { storage, reload })).toBe(false);
    expect(again.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload without usable sessionStorage", () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    const event = preloadEvent("x /assets/a.js");
    expect(handlePreloadError(event, { storage, reload })).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the guard cannot be written", () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(handlePreloadError(preloadEvent("x /a.js"), { storage, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("untilReload", () => {
  it("passes a loaded module through and keeps rejections", async () => {
    const module = { default: () => null };
    await expect(untilReload(Promise.resolve(module))).resolves.toBe(module);
    await expect(untilReload(Promise.reject(new Error("gone")))).rejects.toThrow("gone");
  });

  it("stays pending when the preload helper swallowed the error (module is undefined)", async () => {
    let settled = false;
    void untilReload(Promise.resolve(undefined)).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
  });
});
