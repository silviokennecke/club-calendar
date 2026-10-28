import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { availableLayouts, pdfExportQuery, pdfFailure, pdfRangeTooLong } from "../pdf";

const base = {
  range: "custom" as const,
  today: "2026-10-27",
  from: "2026-10-01",
  to: "2026-10-31",
  includeDrafts: false,
  groupIds: [],
  layout: "month-grid" as const,
  paper: "a4" as const,
  orientation: "auto" as const,
};

describe("pdfExportQuery", () => {
  it("adds layout, paper and orientation to the export query", () => {
    expect(pdfExportQuery(base)).toBe(
      "?from=2026-10-01&to=2026-10-31&layout=month-grid&paper=a4&orientation=auto",
    );
  });

  it("appends the chosen holiday calendars", () => {
    const p = new URLSearchParams(
      pdfExportQuery({ ...base, holidayCalendarIds: ["h1", "h2"] }).slice(1),
    );
    expect(p.getAll("holidayCalendarIds[]")).toEqual(["h1", "h2"]);
    expect(pdfExportQuery(base)).not.toContain("holidayCalendarIds");
  });

  it("keeps drafts and audiences and handles the year range", () => {
    const q = pdfExportQuery({
      ...base,
      range: "year",
      includeDrafts: true,
      groupIds: ["g1", "g2"],
      layout: "annual-overview",
      paper: "a3",
      orientation: "landscape",
    });
    const p = new URLSearchParams(q.slice(1));
    expect(p.get("from")).toBe("2026-01-01");
    expect(p.get("to")).toBe("2026-12-31");
    expect(p.get("includeDrafts")).toBe("1");
    expect(p.getAll("targetGroupIds[]")).toEqual(["g1", "g2"]);
    expect(p.get("layout")).toBe("annual-overview");
    expect(p.get("paper")).toBe("a3");
    expect(p.get("orientation")).toBe("landscape");
  });

  it("still starts with ? when the period is open", () => {
    expect(pdfExportQuery({ ...base, range: "all" })).toBe(
      "?layout=month-grid&paper=a4&orientation=auto",
    );
  });
});

describe("availableLayouts", () => {
  it("always allows month grid and agenda", () => {
    expect(availableLayouts(undefined, undefined)).toMatchObject({
      "month-grid": true,
      agenda: true,
      "quarter-overview": false,
      "annual-overview": false,
    });
  });

  it("allows quarter overview from 3 touched months", () => {
    expect(availableLayouts("2026-10-01", "2026-12-31")["quarter-overview"]).toBe(true);
    expect(availableLayouts("2026-10-31", "2026-12-01")["quarter-overview"]).toBe(true);
    expect(availableLayouts("2026-10-01", "2026-11-30")["quarter-overview"]).toBe(false);
    expect(availableLayouts("2026-11-15", "2027-01-02")["quarter-overview"]).toBe(true);
  });

  it("allows annual overview only for a full calendar year", () => {
    expect(availableLayouts("2026-01-01", "2026-12-31")["annual-overview"]).toBe(true);
    expect(availableLayouts("2026-01-02", "2026-12-31")["annual-overview"]).toBe(false);
    expect(availableLayouts("2026-01-01", "2026-12-30")["annual-overview"]).toBe(false);
    expect(availableLayouts("2026-01-01", "2027-12-31")["annual-overview"]).toBe(false);
  });
});

describe("year ranges for PDF", () => {
  it("builds nextYear query and enables annual layout, also for the leap year 2028", () => {
    for (const [today, year] of [
      ["2026-12-31", "2027"],
      ["2027-01-01", "2028"],
    ] as const) {
      const q = new URLSearchParams(
        pdfExportQuery({ ...base, range: "nextYear", today, layout: "annual-overview" }).slice(1),
      );
      expect(q.get("from")).toBe(`${year}-01-01`);
      expect(q.get("to")).toBe(`${year}-12-31`);
      expect(availableLayouts(q.get("from")!, q.get("to")!)["annual-overview"]).toBe(true);
      expect(pdfRangeTooLong(q.get("from")!, q.get("to")!)).toBe(false);
    }
    expect(pdfRangeTooLong("2028-01-01", "2028-12-31")).toBe(false);
  });
});

describe("pdfRangeTooLong", () => {
  it("allows 366 days between from and to, not more", () => {
    expect(pdfRangeTooLong("2026-01-01", "2027-01-03")).toBe(true);
    expect(pdfRangeTooLong("2026-01-01", "2027-01-02")).toBe(false);
    expect(pdfRangeTooLong("2026-01-01", "2027-01-01")).toBe(false);
    expect(pdfRangeTooLong("2026-01-01", undefined)).toBe(false);
  });
});

describe("pdfFailure", () => {
  it("maps the problem code, never the message", () => {
    expect(pdfFailure(new ApiError("x", 422, "too_many_events", "to")).kind).toBe("tooMany");
    expect(pdfFailure(new ApiError("x", 400, "validation_failed", "to")).kind).toBe("rangeTooLong");
    expect(pdfFailure(new ApiError("x", 400, "validation_failed", "layout")).kind).toBe("generic");
    expect(
      pdfFailure(new ApiError("x", 429, "rate_limited", undefined, { retryAfter: 120 })),
    ).toEqual({ kind: "rateLimited", retryAfter: 120 });
    expect(pdfFailure(new ApiError("x", 422, "quota_exceeded")).kind).toBe("generic");
    expect(pdfFailure(new Error("network")).kind).toBe("generic");
  });
});
