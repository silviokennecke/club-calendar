import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_MAX, RECENT_PREFIX, clearRecent, getRecentIds, recordRecent } from "../recent";

beforeEach(() => {
  clearRecent();
  window.localStorage.clear();
});

describe("recent selections", () => {
  it("puts the id added last at the front", () => {
    recordRecent("u1", "features", "c1", ["a", "b"]);
    expect(getRecentIds("u1", "features", "c1")).toEqual(["b", "a"]);
    recordRecent("u1", "features", "c1", ["c", "a"]);
    expect(getRecentIds("u1", "features", "c1")).toEqual(["a", "c", "b"]);
  });

  it("caps the list", () => {
    const ids = Array.from({ length: RECENT_MAX + 10 }, (_, i) => `id${i}`);
    recordRecent("u1", "properties", "c1", ids);
    const stored = getRecentIds("u1", "properties", "c1");
    expect(stored).toHaveLength(RECENT_MAX);
    expect(stored[0]).toBe(`id${ids.length - 1}`);
  });

  it("scopes per kind and club or calendar", () => {
    recordRecent("u1", "targetGroups", "club1", ["g"]);
    expect(getRecentIds("u1", "targetGroups", "club2")).toEqual([]);
    expect(getRecentIds("u1", "features", "club1")).toEqual([]);
  });

  it("separates users and clears the others", () => {
    recordRecent("u1", "targetGroups", "c", ["a"]);
    recordRecent("u2", "targetGroups", "c", ["b"]);
    expect(getRecentIds("u2", "targetGroups", "c")).toEqual(["b"]);
    clearRecent("u1");
    expect(getRecentIds("u1", "targetGroups", "c")).toEqual(["a"]);
    expect(getRecentIds("u2", "targetGroups", "c")).toEqual([]);
  });

  it("treats corrupt data as empty", () => {
    window.localStorage.setItem(`${RECENT_PREFIX}u1`, "{not json");
    expect(getRecentIds("u1", "features", "c")).toEqual([]);
    window.localStorage.setItem(`${RECENT_PREFIX}u1`, '{"features":{"c":[1,2]},"properties":5}');
    expect(getRecentIds("u1", "features", "c")).toEqual([]);
    recordRecent("u1", "features", "c", ["x"]);
    expect(getRecentIds("u1", "features", "c")).toEqual(["x"]);
  });

  it("works from memory when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    recordRecent("u1", "features", "c", ["a"]);
    expect(getRecentIds("u1", "features", "c")).toEqual(["a"]);
    get.mockRestore();
    set.mockRestore();
  });
});
