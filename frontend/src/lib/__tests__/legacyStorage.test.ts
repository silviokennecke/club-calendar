import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeLegacyStorage } from "../legacyStorage";

describe("purgeLegacyStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("removes the per-club calendars of older releases and keeps everything else", () => {
    window.localStorage.setItem("lastCalendar:u1:c1", "k1");
    window.localStorage.setItem("lastCalendar:u2:c2", "k2");
    window.localStorage.setItem("theme", "dark");
    purgeLegacyStorage();
    expect(window.localStorage.getItem("lastCalendar:u1:c1")).toBeNull();
    expect(window.localStorage.getItem("lastCalendar:u2:c2")).toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("survives a browser that blocks storage", () => {
    const blocked = {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => null,
      removeItem: () => undefined,
    };
    expect(() => purgeLegacyStorage(blocked)).not.toThrow();
  });
});
