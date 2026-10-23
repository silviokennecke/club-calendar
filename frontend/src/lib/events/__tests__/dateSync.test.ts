import { describe, expect, it } from "vitest";
import { applyEndDate, applyStartDate, applyTimeBegin, effectiveEndDate } from "../dateSync";

const base = { date: "2026-10-10", dateEnd: "", timeBegin: "18:00", timeEnd: "20:00" };

describe("dateSync", () => {
  it("shows the start as end for single-day events", () => {
    expect(effectiveEndDate(base)).toBe("2026-10-10");
    expect(effectiveEndDate({ ...base, dateEnd: "2026-10-12" })).toBe("2026-10-12");
  });

  it("moves the end with the start keeping the duration", () => {
    const v = applyStartDate({ ...base, dateEnd: "2026-10-12" }, "2026-10-20");
    expect(v.date).toBe("2026-10-20");
    expect(v.dateEnd).toBe("2026-10-22");
  });

  it("keeps a single-day event single-day", () => {
    expect(applyStartDate(base, "2026-10-20").dateEnd).toBe("");
  });

  it("ignores an invalid start date", () => {
    expect(applyStartDate({ ...base, dateEnd: "2026-10-12" }, "")).toEqual({
      ...base,
      date: "",
      dateEnd: "2026-10-12",
    });
  });

  it("pulls the start back when the end is before it", () => {
    const v = applyEndDate({ ...base, dateEnd: "2026-10-12" }, "2026-10-08");
    expect(v.date).toBe("2026-10-08");
    expect(v.dateEnd).toBe("");
  });

  it("sets a later end", () => {
    expect(applyEndDate(base, "2026-10-11").dateEnd).toBe("2026-10-11");
    expect(applyEndDate({ ...base, dateEnd: "2026-10-11" }, "2026-10-10").dateEnd).toBe("");
  });

  it("raises the end time on the same day only", () => {
    expect(applyTimeBegin(base, "21:00").timeEnd).toBe("21:00");
    expect(applyTimeBegin(base, "19:00").timeEnd).toBe("20:00");
    expect(applyTimeBegin({ ...base, dateEnd: "2026-10-11" }, "21:00").timeEnd).toBe("20:00");
  });
});
