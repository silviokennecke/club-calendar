import { describe, expect, it } from "vitest";
import { isBusyItem, resourceItems } from "../resourceCalendar";
import type { ResourceBusyItem, ResourceCalendarEvent } from "../types";

const full: ResourceCalendarEvent = {
  id: "e1",
  name: "Training",
  calendarId: "k1",
  calendarName: "Schießbetrieb",
  date: "2026-10-08",
  dateEnd: null,
  timeBegin: "19:00",
  timeEnd: "21:00",
  isAllDay: false,
  timezone: "Europe/Berlin",
  isDraft: true,
};
const busy: ResourceBusyItem = {
  calendarName: "Jugend",
  date: "2026-10-09",
  dateEnd: "2026-10-10",
  timeBegin: "00:00",
  timeEnd: "00:00",
  isAllDay: true,
  timezone: "Europe/Berlin",
};

describe("resourceItems", () => {
  it("shows name and calendar for full items, keeps the draft flag", () => {
    const [item] = resourceItems([full], "Belegt");
    expect(item).toMatchObject({
      id: "e1",
      title: "Training · Schießbetrieb",
      start: "2026-10-08",
      timeBegin: "19:00",
      isDraft: true,
    });
  });

  it("labels busy-only items and gives them stable ids", () => {
    expect(isBusyItem(busy)).toBe(true);
    expect(isBusyItem(full)).toBe(false);
    const items = resourceItems([busy, busy], "Belegt");
    expect(items[0]).toMatchObject({
      id: "busy-0",
      title: "Belegt · Jugend",
      end: "2026-10-10",
      allDay: true,
      isDraft: false,
    });
    expect(items[1].id).toBe("busy-1");
  });
});
