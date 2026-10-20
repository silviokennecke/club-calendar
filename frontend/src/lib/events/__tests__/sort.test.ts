import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/types";
import { DEFAULT_SORT, nextSort, parseSort, serializeSort, sortEvents } from "../list";

function ev(partial: Partial<CalendarEvent> & { id: string; name: string }) {
  return {
    date: "2026-10-01",
    timeBegin: "19:00",
    isAllDay: false,
    isDraft: false,
    location: null,
    targetGroups: [],
    ...partial,
  } as CalendarEvent;
}

const ids = (list: CalendarEvent[]) => list.map((e) => e.id);

describe("sortEvents", () => {
  const list = [
    ev({ id: "a", name: "Zeta", date: "2026-10-03", location: { name: "Halle" } as never }),
    ev({ id: "b", name: "Ärger", date: "2026-10-01", isDraft: true }),
    ev({ id: "c", name: "alpha", date: "2026-10-02", location: { name: "Anger" } as never }),
    ev({ id: "d", name: "Alpha", date: "2026-10-02", isDraft: true }),
  ];

  it("sorts text locale-aware and case-insensitively, ties keep the default order", () => {
    expect(ids(sortEvents(list, { key: "name", dir: "asc" }, "de"))).toEqual(["c", "d", "b", "a"]);
    expect(ids(sortEvents(list, { key: "name", dir: "desc" }, "de"))).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by date, ascending and descending", () => {
    expect(ids(sortEvents(list, DEFAULT_SORT, "de"))).toEqual(["b", "c", "d", "a"]);
    expect(ids(sortEvents(list, { key: "date", dir: "desc" }, "de"))).toEqual(["a", "d", "c", "b"]);
  });

  it("puts events without a place last in both directions", () => {
    expect(ids(sortEvents(list, { key: "place", dir: "asc" }, "de"))).toEqual(["c", "a", "b", "d"]);
    expect(ids(sortEvents(list, { key: "place", dir: "desc" }, "de"))).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("sorts published before drafts and is stable", () => {
    expect(ids(sortEvents(list, { key: "status", dir: "asc" }, "de"))).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    expect(ids(sortEvents(list, { key: "status", dir: "desc" }, "de"))).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });

  it("does not mutate the input", () => {
    const copy = [...list];
    sortEvents(list, { key: "name", dir: "desc" }, "de");
    expect(list).toEqual(copy);
  });
});

describe("sort state", () => {
  it("cycles ascending, descending, default", () => {
    const asc = nextSort(DEFAULT_SORT, "name");
    expect(asc).toEqual({ key: "name", dir: "asc" });
    const desc = nextSort(asc, "name");
    expect(desc).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(desc, "name")).toEqual(DEFAULT_SORT);
    expect(nextSort(DEFAULT_SORT, "date")).toEqual({ key: "date", dir: "desc" });
  });

  it("round-trips through the URL value", () => {
    expect(serializeSort(DEFAULT_SORT)).toBe("");
    expect(parseSort(serializeSort({ key: "place", dir: "desc" }))).toEqual({
      key: "place",
      dir: "desc",
    });
    expect(parseSort("bogus")).toEqual(DEFAULT_SORT);
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
  });
});
