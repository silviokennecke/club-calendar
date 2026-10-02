import { describe, expect, it } from "vitest";
import { monthGrid, weekDays } from "../dates";
import {
  compareItems,
  countByDay,
  coversDay,
  eventToItem,
  holidayToItem,
  isMultiDay,
  itemsOnDay,
  layoutWeek,
  matchesSearch,
  overlapsRange,
  shiftEventDates,
  type CalItem,
  type EventLike,
} from "../items";

function ev(partial: Partial<EventLike> & { id: string; date: string }): EventLike {
  return {
    name: partial.id,
    timeBegin: "19:00:00",
    timeEnd: "21:00:00",
    properties: [],
    ...partial,
  };
}

describe("eventToItem", () => {
  it("normalizes a timed single-day event", () => {
    const item = eventToItem(
      ev({
        id: "1",
        name: "Training",
        date: "2026-10-08T00:00:00+00:00",
        isDraft: true,
        properties: [
          { property: { name: "Draußen", icon: "🌳" } },
          { property: { name: "Ohne Symbol", icon: null } },
          { property: { name: "Anmeldung nötig", icon: "📝" } },
        ],
      }),
    );
    expect(item).toMatchObject({
      id: "1",
      kind: "event",
      title: "Training",
      start: "2026-10-08",
      end: "2026-10-08",
      allDay: false,
      timeBegin: "19:00",
      timeEnd: "21:00",
      isDraft: true,
      icons: "🌳📝",
      iconLabel: "Draußen, Anmeldung nötig",
    });
    expect(isMultiDay(item)).toBe(false);
  });

  it("keeps the inclusive end of multi-day and all-day events", () => {
    const item = eventToItem(
      ev({ id: "2", date: "2026-10-10", dateEnd: "2026-10-11", isAllDay: true }),
    );
    expect(item.end).toBe("2026-10-11");
    expect(item.allDay).toBe(true);
    expect(item.timeBegin).toBeUndefined();
    expect(isMultiDay(item)).toBe(true);
  });

  it("spans midnight for timed events with an end date", () => {
    const item = eventToItem(
      ev({
        id: "3",
        date: "2026-10-24",
        dateEnd: "2026-10-25",
        timeBegin: "20:00",
        timeEnd: "02:00",
      }),
    );
    expect(coversDay(item, "2026-10-25")).toBe(true);
    expect(item.timeBegin).toBe("20:00");
  });

  it("collapses invalid end dates to the start", () => {
    expect(eventToItem(ev({ id: "4", date: "2026-10-10", dateEnd: "2026-10-01" })).end).toBe(
      "2026-10-10",
    );
    expect(eventToItem(ev({ id: "5", date: "2026-10-10", dateEnd: "" })).end).toBe("2026-10-10");
  });
});

describe("holidayToItem", () => {
  it("is all-day and prefixed", () => {
    const item = holidayToItem({
      id: "h1",
      name: "Tag der Deutschen Einheit",
      date: "2026-10-03",
      dateEnd: null,
    });
    expect(item).toMatchObject({
      id: "holiday-h1",
      kind: "holiday",
      allDay: true,
      end: "2026-10-03",
    });
  });
});

describe("ranges and ordering", () => {
  const a = eventToItem(ev({ id: "a", date: "2026-10-10", dateEnd: "2026-10-12" }));

  it("checks day coverage and overlap", () => {
    expect(coversDay(a, "2026-10-09")).toBe(false);
    expect(coversDay(a, "2026-10-10")).toBe(true);
    expect(coversDay(a, "2026-10-12")).toBe(true);
    expect(coversDay(a, "2026-10-13")).toBe(false);
    expect(overlapsRange(a, "2026-10-12", "2026-10-18")).toBe(true);
    expect(overlapsRange(a, "2026-10-13", "2026-10-18")).toBe(false);
    expect(overlapsRange(a, "2026-10-01", "2026-10-10")).toBe(true);
  });

  it("sorts holidays first, then longer, all-day and earlier items", () => {
    const hol = holidayToItem({ id: "h", name: "Feiertag", date: "2026-10-10" });
    const late = eventToItem(ev({ id: "late", date: "2026-10-10", timeBegin: "20:00" }));
    const early = eventToItem(ev({ id: "early", date: "2026-10-10", timeBegin: "08:00" }));
    const allDay = eventToItem(ev({ id: "allday", date: "2026-10-10", isAllDay: true }));
    const sorted = [late, early, a, allDay, hol].sort(compareItems).map((i) => i.id);
    expect(sorted).toEqual(["holiday-h", "a", "allday", "early", "late"]);
  });

  it("lists and counts items per day", () => {
    const b = eventToItem(ev({ id: "b", date: "2026-10-11" }));
    expect(itemsOnDay([b, a], "2026-10-11").map((i) => i.id)).toEqual(["a", "b"]);
    const counts = countByDay([a, b], weekDays("2026-10-08"));
    expect(counts.get("2026-10-10")).toBe(1);
    expect(counts.get("2026-10-11")).toBe(2);
    expect(counts.has("2026-10-08")).toBe(false);
  });

  it("searches case-insensitively", () => {
    const item = eventToItem(ev({ id: "x", name: "Herbstfest", date: "2026-10-24" }));
    expect(matchesSearch(item, "  HERBST ")).toBe(true);
    expect(matchesSearch(item, "Sommer")).toBe(false);
    expect(matchesSearch(item, "")).toBe(true);
  });
});

describe("layoutWeek", () => {
  const week = weekDays("2026-10-05"); // Mon 5 – Sun 11 October

  function items(...list: CalItem[]) {
    return list;
  }

  it("places a multi-day event as one bar across its columns", () => {
    const meet = eventToItem(
      ev({ id: "m", date: "2026-10-10", dateEnd: "2026-10-11", isAllDay: true }),
    );
    const { segments, overflow } = layoutWeek(items(meet), week);
    expect(segments).toEqual([
      expect.objectContaining({
        startCol: 5,
        endCol: 6,
        lane: 0,
        continuesBefore: false,
        continuesAfter: false,
      }),
    ]);
    expect(overflow).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("clips events that continue into the previous/next week", () => {
    const long = eventToItem(ev({ id: "l", date: "2026-10-03", dateEnd: "2026-10-13" }));
    const [seg] = layoutWeek(items(long), week).segments;
    expect(seg).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  it("stacks overlapping items in lanes and reuses free lanes", () => {
    const x = eventToItem(ev({ id: "x", date: "2026-10-05", dateEnd: "2026-10-07" }));
    const y = eventToItem(ev({ id: "y", date: "2026-10-06" }));
    const z = eventToItem(ev({ id: "z", date: "2026-10-08" }));
    const lanes = Object.fromEntries(
      layoutWeek(items(z, y, x), week).segments.map((s) => [s.item.id, s.lane]),
    );
    expect(lanes).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("puts holidays on top and counts what does not fit", () => {
    const hol = holidayToItem({ id: "h", name: "Feiertag", date: "2026-10-07" });
    const list = items(
      eventToItem(ev({ id: "e1", date: "2026-10-07", timeBegin: "08:00" })),
      eventToItem(ev({ id: "e2", date: "2026-10-07", timeBegin: "09:00" })),
      eventToItem(ev({ id: "e3", date: "2026-10-07", timeBegin: "10:00" })),
      hol,
    );
    const { segments, overflow } = layoutWeek(list, week, 3);
    expect(segments.map((s) => s.item.id)).toEqual(["holiday-h", "e1", "e2"]);
    expect(overflow[2]).toBe(1);
  });

  it("lets earlier events use the holiday lane before the holiday", () => {
    // Holiday on Friday is placed first; Monday events must not be pushed below it.
    const hol = holidayToItem({ id: "h", name: "Feiertag", date: "2026-10-09" });
    const list = items(
      hol,
      eventToItem(ev({ id: "a", date: "2026-10-05", timeBegin: "08:00" })),
      eventToItem(ev({ id: "b", date: "2026-10-05", timeBegin: "09:00" })),
      eventToItem(ev({ id: "c", date: "2026-10-05", timeBegin: "10:00" })),
    );
    const { segments, overflow } = layoutWeek(list, week, 3);
    const lanes = Object.fromEntries(segments.map((s) => [s.item.id, s.lane]));
    expect(lanes).toEqual({ "holiday-h": 0, a: 0, b: 1, c: 2 });
    expect(overflow).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("never overlaps bars in one lane", () => {
    const hol = holidayToItem({ id: "h", name: "Feiertag", date: "2026-10-07" });
    const long = eventToItem(ev({ id: "l", date: "2026-10-05", dateEnd: "2026-10-09" }));
    const short = eventToItem(ev({ id: "s", date: "2026-10-05" }));
    const { segments } = layoutWeek(items(hol, long, short), week, 3);
    const lanes = Object.fromEntries(segments.map((s) => [s.item.id, s.lane]));
    expect(lanes["holiday-h"]).toBe(0);
    expect(lanes.l).not.toBe(0);
    expect(lanes.s).not.toBe(lanes.l);
  });

  it("splits an event across the year boundary into two week rows", () => {
    const dec = monthGrid({ year: 2026, month: 11 });
    const lastRow = dec[dec.length - 1]; // 28 Dec 2026 – 3 Jan 2027
    const jan = monthGrid({ year: 2027, month: 0 });
    const party = eventToItem(ev({ id: "p", date: "2026-12-31", dateEnd: "2027-01-05" }));
    expect(layoutWeek(items(party), lastRow).segments[0]).toMatchObject({
      startCol: 3,
      endCol: 6,
      continuesAfter: true,
    });
    const second = jan.find((w) => w.includes("2027-01-04"))!;
    expect(layoutWeek(items(party), second).segments[0]).toMatchObject({
      startCol: 0,
      endCol: 1,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it("ignores items outside the week", () => {
    const outside = eventToItem(ev({ id: "o", date: "2026-10-20" }));
    expect(layoutWeek(items(outside), week).segments).toHaveLength(0);
  });

  it("works across a month boundary row", () => {
    const row = monthGrid({ year: 2026, month: 9 })[0]; // 28 Sep – 4 Oct
    const turn = eventToItem(ev({ id: "t", date: "2026-09-30", dateEnd: "2026-10-02" }));
    const [seg] = layoutWeek(items(turn), row).segments;
    expect(seg).toMatchObject({ startCol: 2, endCol: 4 });
  });
});

describe("shiftEventDates", () => {
  it("moves single-day events without an end date", () => {
    expect(shiftEventDates({ date: "2026-10-08" }, "2026-10-16")).toEqual({
      date: "2026-10-16",
      dateEnd: null,
    });
  });

  it("keeps the length of multi-day events", () => {
    expect(shiftEventDates({ date: "2026-10-10", dateEnd: "2026-10-11" }, "2026-10-17")).toEqual({
      date: "2026-10-17",
      dateEnd: "2026-10-18",
    });
    // Across a month end and the end of DST.
    expect(shiftEventDates({ date: "2026-10-24", dateEnd: "2026-10-26" }, "2026-10-30")).toEqual({
      date: "2026-10-30",
      dateEnd: "2026-11-01",
    });
  });
});
