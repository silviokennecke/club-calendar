import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/types";
import {
  countByStatus,
  emptyKind,
  filterEvents,
  groupByMonth,
  parseStatusTab,
  summarizeSelection,
} from "../list";
import {
  buildIcs,
  escapeText,
  exportFileName,
  exportQuery,
  exportRange,
  foldLine,
  icsFileName,
  monthBounds,
  selectForExport,
  zonedTimeToUtc,
} from "../ics";
import { formatEventDates, formatShortDate, joinList } from "../format";

function ev(partial: Partial<CalendarEvent> & { id: string; name: string; date: string }) {
  return {
    calendarId: "k1",
    dateEnd: null,
    timeBegin: "19:00",
    timeEnd: "21:00",
    isAllDay: false,
    timezone: null,
    isDraft: false,
    locationId: null,
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
    ...partial,
  } as CalendarEvent;
}

const youth = { targetGroup: { id: "g1", clubId: "k1", name: "Jugend" } };
const adults = { targetGroup: { id: "g2", clubId: "k1", name: "Erwachsene" } };

const events = [
  ev({
    id: "3",
    name: "Vorstandssitzung",
    date: "2026-10-07",
    isDraft: true,
    targetGroups: [adults],
  }),
  ev({ id: "1", name: "Training Luftgewehr", date: "2026-10-01", targetGroups: [adults] }),
  ev({
    id: "2",
    name: "Jugendtraining",
    date: "2026-10-05",
    timeBegin: "18:00",
    targetGroups: [youth],
  }),
  ev({ id: "4", name: "Herbstfest", date: "2026-11-24", isAllDay: true }),
];

describe("event list", () => {
  it("sorts by date and filters by tab, search and audience", () => {
    const all = filterEvents(events, { tab: "all", query: "", groupIds: [] });
    expect(all.map((e) => e.id)).toEqual(["1", "2", "3", "4"]);
    expect(
      filterEvents(events, { tab: "draft", query: "", groupIds: [] }).map((e) => e.id),
    ).toEqual(["3"]);
    expect(
      filterEvents(events, { tab: "all", query: "TRAINING", groupIds: [] }).map((e) => e.id),
    ).toEqual(["1", "2"]);
    expect(
      filterEvents(events, { tab: "published", query: "", groupIds: ["g2"] }).map((e) => e.id),
    ).toEqual(["1"]);
  });

  it("counts tabs with search and audience applied", () => {
    expect(countByStatus(events, { query: "", groupIds: [] })).toEqual({
      all: 4,
      published: 3,
      draft: 1,
    });
    expect(countByStatus(events, { query: "training", groupIds: [] })).toEqual({
      all: 2,
      published: 2,
      draft: 0,
    });
  });

  it("groups by month", () => {
    const groups = groupByMonth(filterEvents(events, { tab: "all", query: "", groupIds: [] }));
    expect(groups.map((g) => [g.month, g.events.length])).toEqual([
      ["2026-10-01", 3],
      ["2026-11-01", 1],
    ]);
  });

  it("names the right empty state", () => {
    const f = { tab: "all" as const, query: "", groupIds: [] };
    expect(emptyKind(0, 0, f)).toBe("noCalendarEvents");
    expect(emptyKind(4, 0, { ...f, query: "Schwimmen" })).toBe("noSearchHits");
    expect(emptyKind(4, 0, { ...f, tab: "published" })).toBe("noPublished");
    expect(emptyKind(4, 0, { ...f, tab: "draft" })).toBe("noDrafts");
    expect(emptyKind(4, 0, { ...f, groupIds: ["g1"] })).toBe("noFilterHits");
    expect(emptyKind(4, 2, f)).toBe("none");
  });

  it("parses tabs and summarizes selections", () => {
    expect(parseStatusTab("draft")).toBe("draft");
    expect(parseStatusTab("x")).toBe("all");
    expect(summarizeSelection(events)).toEqual({ count: 4, drafts: 1, published: 3 });
  });

  it("formats lists and dates", () => {
    expect(joinList(["A", "B", "C"], "und")).toBe("A, B und C");
    expect(joinList(["A"], "und")).toBe("A");
    expect(formatShortDate("2026-10-17", "de")).toBe("17.10.");
    expect(formatEventDates({ date: "2026-10-10", dateEnd: "2026-10-11" }, "de")).toBe(
      "10.10.2026 – 11.10.2026",
    );
  });
});

describe("export selection", () => {
  const base = { today: "2026-10-02", includeDrafts: false, groupIds: [] as string[] };

  it("exports only published events of the whole calendar by default", () => {
    expect(selectForExport(events, { ...base, range: "all" }).map((e) => e.id)).toEqual([
      "1",
      "2",
      "4",
    ]);
  });

  it("limits to this month, a custom range, drafts and audiences", () => {
    expect(monthBounds("2026-02-10")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(selectForExport(events, { ...base, range: "month" }).map((e) => e.id)).toEqual([
      "1",
      "2",
    ]);
    expect(
      selectForExport(events, {
        ...base,
        range: "custom",
        from: "2026-10-04",
        to: "2026-10-31",
        includeDrafts: true,
      }).map((e) => e.id),
    ).toEqual(["3", "2"]);
    expect(
      selectForExport(events, { ...base, range: "all", groupIds: ["g1"] }).map((e) => e.id),
    ).toEqual(["2"]);
  });

  it("counts multi-day events that overlap the range", () => {
    const long = ev({ id: "m", name: "Fahrt", date: "2026-09-29", dateEnd: "2026-10-02" });
    expect(selectForExport([long], { ...base, range: "month" })).toHaveLength(1);
  });
});

describe("ICS", () => {
  it("converts wall-clock times of a zone to UTC (summer and winter time)", () => {
    expect(zonedTimeToUtc("2026-10-01", "19:00", "Europe/Berlin").toISOString()).toBe(
      "2026-10-01T17:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-12-01", "19:00", "Europe/Berlin").toISOString()).toBe(
      "2026-12-01T18:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-12-01", "19:00", null).toISOString()).toBe(
      "2026-12-01T19:00:00.000Z",
    );
  });

  it("escapes and folds text", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine(`SUMMARY:${"ä".repeat(60)}`);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"ä".repeat(60)}`);
  });

  it("builds a calendar with timed and all-day events", () => {
    const ics = buildIcs(
      [
        ev({
          id: "1",
          name: "Training, Luftgewehr",
          date: "2026-10-01",
          properties: [{ property: { id: "p", calendarid: "k1", name: "Wettkampf", icon: "🏆" } }],
          features: [{ feature: { id: "f", calendarid: "k1", name: "Bonusschießen" } }],
          targetGroups: [adults],
          location: {
            id: "l",
            clubId: "k1",
            name: "Schützenhaus",
            city: "Musterstadt",
            latitude: 51.5,
            longitude: 7.25,
          },
        }),
        ev({
          id: "2",
          name: "Meisterschaft",
          date: "2026-10-10",
          dateEnd: "2026-10-11",
          isAllDay: true,
          isDraft: true,
        }),
      ],
      {
        name: "Schießbetrieb 2026",
        timeZone: "Europe/Berlin",
        labels: { features: "Zusatzangebote", targetGroups: "Gruppen" },
        now: new Date("2026-10-02T08:00:00Z"),
      },
    );
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(lines).toContain("UID:event-1@club-calendar");
    expect(lines).toContain("SUMMARY:🏆 Training\\, Luftgewehr");
    expect(lines).toContain("DTSTART:20261001T170000Z");
    expect(lines).toContain("DTEND:20261001T190000Z");
    expect(lines).toContain("DESCRIPTION:Zusatzangebote: Bonusschießen\\nGruppen: Erwachsene");
    expect(lines).toContain("LOCATION:Schützenhaus\\, Musterstadt");
    expect(lines).toContain("GEO:51.5;7.25");
    expect(lines).toContain("DTSTART;VALUE=DATE:20261010");
    expect(lines).toContain("DTEND;VALUE=DATE:20261012");
    expect(lines).toContain("STATUS:TENTATIVE");
    expect(lines).toContain("X-WR-CALNAME:Schießbetrieb 2026");
  });

  it("derives a file name", () => {
    expect(icsFileName("Schießbetrieb 2026")).toBe("schiessbetrieb-2026.ics");
    expect(icsFileName("!!!")).toBe("termine.ics");
  });
});

describe("export file name and year range", () => {
  it("slugifies the calendar name for both formats", () => {
    expect(exportFileName("Schießbetrieb 2026", "pdf")).toBe("schiessbetrieb-2026.pdf");
    expect(exportFileName("", "ics")).toBe("termine.ics");
    expect(icsFileName("Schießbetrieb 2026")).toBe("schiessbetrieb-2026.ics");
  });

  it("covers the calendar year of today for range year", () => {
    expect(
      exportRange({ range: "year", today: "2026-10-27", includeDrafts: false, groupIds: [] }),
    ).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("covers next calendar year across the year boundary", () => {
    const next = (today: string) =>
      exportRange({ range: "nextYear", today, includeDrafts: false, groupIds: [] });
    expect(next("2026-12-31")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(next("2027-01-01")).toEqual({ from: "2028-01-01", to: "2028-12-31" });
    const year = (today: string) =>
      exportRange({ range: "year", today, includeDrafts: false, groupIds: [] });
    expect(year("2026-12-31")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(year("2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
  });

  it("sends from/to for both year ranges and counts overlapping events", () => {
    const o = { today: "2026-12-31", includeDrafts: false, groupIds: [] };
    expect(exportQuery({ ...o, range: "year" })).toBe("?from=2026-01-01&to=2026-12-31");
    expect(exportQuery({ ...o, range: "nextYear" })).toBe("?from=2027-01-01&to=2027-12-31");
    const evs = [
      ev({ id: "a", name: "A", date: "2026-12-30", dateEnd: "2027-01-02" }),
      ev({ id: "b", name: "B", date: "2027-06-01" }),
      ev({ id: "c", name: "C", date: "2028-01-01" }),
    ];
    const ids = (range: "year" | "nextYear") =>
      selectForExport(evs, { ...o, range }).map((e) => e.id);
    expect(ids("year")).toEqual(["a"]);
    expect(ids("nextYear")).toEqual(["a", "b"]);
  });
});
