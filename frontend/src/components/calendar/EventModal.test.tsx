import { describe, it, expect } from "vitest";
import { filterDatesExcludingHolidays } from "./EventModal";
import type { HolidayEvent } from "@/lib/types";

describe("filterDatesExcludingHolidays", () => {
  it("removes a date that matches a single-day holiday exactly", () => {
    const holidays: HolidayEvent[] = [
      { id: "1", holidayCalendarId: "1", name: "Christmas", date: "2026-12-25", dateEnd: null },
    ];
    expect(filterDatesExcludingHolidays(["2026-12-18", "2026-12-25"], holidays)).toEqual([
      "2026-12-18",
    ]);
  });

  it("removes dates that fall within a multi-day holiday range (inclusive both ends)", () => {
    const holidays: HolidayEvent[] = [
      {
        id: "1",
        holidayCalendarId: "1",
        name: "Christmas",
        date: "2026-12-25",
        dateEnd: "2026-12-26",
      },
    ];
    expect(
      filterDatesExcludingHolidays(["2026-12-25", "2026-12-26", "2026-12-27"], holidays),
    ).toEqual(["2026-12-27"]);
  });

  it("keeps all dates when there are no holidays", () => {
    expect(filterDatesExcludingHolidays(["2026-12-18", "2026-12-25"], [])).toEqual([
      "2026-12-18",
      "2026-12-25",
    ]);
  });

  it("handles a date range spanning two separate holidays", () => {
    const holidays: HolidayEvent[] = [
      { id: "1", holidayCalendarId: "1", name: "Christmas", date: "2026-12-25", dateEnd: null },
      { id: "2", holidayCalendarId: "1", name: "New Year", date: "2027-01-01", dateEnd: null },
    ];
    const dates = ["2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01"];
    expect(filterDatesExcludingHolidays(dates, holidays)).toEqual(["2026-12-24", "2026-12-31"]);
  });
});
