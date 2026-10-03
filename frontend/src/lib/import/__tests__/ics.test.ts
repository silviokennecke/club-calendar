import { describe, expect, it } from "vitest";
import { buildIcs } from "@/lib/events/ics";
import type { CalendarEvent } from "@/lib/types";
import { isIcsFile, parseDuration, parseIcs, unescapeIcsText, unfoldIcs, utcToZone } from "../ics";

const wrap = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

describe("unfoldIcs / unescapeIcsText", () => {
  it("joins folded lines and handles CRLF", () => {
    expect(unfoldIcs("SUMMARY:Vereins\r\n meisterschaft\r\nUID:1")).toEqual([
      "SUMMARY:Vereinsmeisterschaft",
      "UID:1",
    ]);
  });
  it("resolves TEXT escapes", () => {
    expect(unescapeIcsText("A\\, B\\; C\\nD\\\\E")).toBe("A, B; C\nD\\E");
  });
});

describe("parseIcs", () => {
  it("reads a timed event with TZID, location and uid", () => {
    const { events, skipped } = parseIcs(
      wrap(
        vevent(
          "UID:abc@x",
          "SUMMARY:Training Luftgewehr",
          "DTSTART;TZID=Europe/Berlin:20261010T190000",
          "DTEND;TZID=Europe/Berlin:20261010T210000",
          "LOCATION:Schützenhaus Waldblick\\, Waldstraße 12",
        ),
      ),
    );
    expect(skipped).toEqual([]);
    expect(events).toEqual([
      {
        uid: "abc@x",
        name: "Training Luftgewehr",
        date: "2026-10-10",
        dateEnd: "",
        isAllDay: false,
        timeBegin: "19:00",
        timeEnd: "21:00",
        timezone: "Europe/Berlin",
        locationText: "Schützenhaus Waldblick, Waldstraße 12",
        recurring: false,
      },
    ]);
  });

  it("treats an all-day DTEND as exclusive", () => {
    const { events } = parseIcs(
      wrap(
        vevent("SUMMARY:Meisterschaft", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261012"),
        vevent("SUMMARY:Ein Tag", "DTSTART;VALUE=DATE:20261015", "DTEND;VALUE=DATE:20261016"),
      ),
    );
    expect(events[0]).toMatchObject({
      isAllDay: true,
      date: "2026-10-10",
      dateEnd: "2026-10-11",
      timeBegin: "00:00",
      timeEnd: "23:59",
    });
    expect(events[1].dateEnd).toBe("");
  });

  it("keeps the end date of multi-day timed events", () => {
    const { events } = parseIcs(
      wrap(vevent("SUMMARY:Lager", "DTSTART:20261010T180000", "DTEND:20261011T100000")),
    );
    expect(events[0]).toMatchObject({
      dateEnd: "2026-10-11",
      timeBegin: "18:00",
      timeEnd: "10:00",
    });
  });

  it("uses the start as the end time without DTEND", () => {
    const { events } = parseIcs(wrap(vevent("SUMMARY:X", "DTSTART:20261010T180000")));
    expect(events[0]).toMatchObject({ timeBegin: "18:00", timeEnd: "18:00" });
  });

  it("converts UTC times to the calendar time zone", () => {
    const { events } = parseIcs(
      wrap(vevent("SUMMARY:X", "DTSTART:20261010T230000Z", "DTEND:20261011T010000Z")),
      { timeZone: "Europe/Berlin" },
    );
    // CEST = UTC+2: the evening of the 10th is already the 11th, 01:00 - 03:00
    expect(events[0]).toMatchObject({
      date: "2026-10-11",
      timeBegin: "01:00",
      timeEnd: "03:00",
      dateEnd: "",
    });
    expect(utcToZone("2026-01-10", "12:00", "Europe/Berlin")).toEqual({
      date: "2026-01-10",
      time: "13:00",
    });
  });

  it("reports events without name or valid date and ignores VALARM content", () => {
    const { events, skipped } = parseIcs(
      wrap(
        vevent("SUMMARY:Ohne Datum"),
        vevent("SUMMARY:Falsch", "DTSTART:20261340"),
        vevent("SUMMARY:Februar", "DTSTART;VALUE=DATE:20260230"),
        vevent("DTSTART:20261010T180000"),
        [
          "BEGIN:VEVENT",
          "SUMMARY:Mit Alarm",
          "DTSTART:20261010T180000",
          "BEGIN:VALARM",
          "SUMMARY:Alarm",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(events.map((e) => e.name)).toEqual(["Mit Alarm"]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "noDate",
      "invalidDate",
      "invalidDate",
      "noName",
    ]);
  });

  it("flags recurring events and generates uids", () => {
    const { events } = parseIcs(
      wrap(vevent("SUMMARY:Wöchentlich", "DTSTART:20261010T180000", "RRULE:FREQ=WEEKLY")),
    );
    expect(events[0].recurring).toBe(true);
    expect(events[0].uid).toBe("imported-1");
  });

  it("returns nothing for text without events", () => {
    expect(parseIcs("hello")).toEqual({ events: [], skipped: [] });
  });
});

describe("isIcsFile", () => {
  it("accepts by extension or MIME type", () => {
    expect(isIcsFile({ name: "Plan.ICS", type: "" })).toBe(true);
    expect(isIcsFile({ name: "plan", type: "text/calendar" })).toBe(true);
    expect(isIcsFile({ name: "plan.txt", type: "text/plain" })).toBe(false);
  });
});

describe("parseIcs: RFC 5545 corner cases", () => {
  it("uses DURATION when there is no DTEND", () => {
    const { events } = parseIcs(
      wrap(
        vevent("SUMMARY:Kurz", "DTSTART:20261010T180000", "DURATION:PT90M"),
        vevent("SUMMARY:Nacht", "DTSTART:20261010T230000", "DURATION:PT2H"),
        vevent("SUMMARY:Drei Tage", "DTSTART;VALUE=DATE:20261020", "DURATION:P3D"),
        vevent("SUMMARY:Woche", "DTSTART;VALUE=DATE:20261020", "DURATION:P1W"),
      ),
    );
    expect(events[0]).toMatchObject({ timeBegin: "18:00", timeEnd: "19:30", dateEnd: "" });
    expect(events[1]).toMatchObject({
      timeBegin: "23:00",
      timeEnd: "01:00",
      dateEnd: "2026-10-11",
    });
    expect(events[2]).toMatchObject({ isAllDay: true, date: "2026-10-20", dateEnd: "2026-10-22" });
    expect(events[3]).toMatchObject({ dateEnd: "2026-10-26" });
    expect(parseDuration("garbage")).toBeNull();
    expect(parseDuration("P")).toBeNull();
  });

  it("drops time zone names that are not IANA zones (Outlook), keeps real ones", () => {
    const { events } = parseIcs(
      wrap(
        vevent("SUMMARY:A", "DTSTART;TZID=W. Europe Standard Time:20261012T190000"),
        vevent("SUMMARY:B", "DTSTART;TZID=America/New_York:20261012T190000"),
        vevent("SUMMARY:C", 'DTSTART;TZID="Europe/Berlin":20261012T190000'),
      ),
    );
    expect(events.map((e) => e.timezone)).toEqual([null, "America/New_York", "Europe/Berlin"]);
    expect(events[0].timeBegin).toBe("19:00");
  });

  it("keeps floating times as they are and does not shift them", () => {
    const { events } = parseIcs(wrap(vevent("SUMMARY:F", "DTSTART:20261014T190000")), {
      timeZone: "Europe/Berlin",
    });
    expect(events[0]).toMatchObject({ date: "2026-10-14", timeBegin: "19:00" });
  });

  it("converts UTC across the DST switches of the calendar zone", () => {
    const { events } = parseIcs(
      wrap(
        vevent("SUMMARY:vor", "DTSTART:20260328T220000Z", "DTEND:20260328T230000Z"),
        vevent("SUMMARY:nach", "DTSTART:20260329T000500Z", "DTEND:20260329T010500Z"),
        vevent("SUMMARY:herbst", "DTSTART:20261024T230000Z", "DTEND:20261025T020000Z"),
      ),
      { timeZone: "Europe/Berlin" },
    );
    expect(events[0]).toMatchObject({
      date: "2026-03-28",
      timeBegin: "23:00",
      dateEnd: "2026-03-29",
      timeEnd: "00:00",
    });
    expect(events[1]).toMatchObject({ date: "2026-03-29", timeBegin: "01:05", timeEnd: "03:05" });
    expect(events[2]).toMatchObject({ date: "2026-10-25", timeBegin: "01:00", timeEnd: "03:00" });
  });

  it("folds multi-byte text, LF-only files and a BOM before the calendar", () => {
    const text =
      "\uFEFFBEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Sch\u00fctzenfest \u{1F3AF} mit langem\n  Titel\nDTSTART:20261001T190000\nEND:VEVENT\nEND:VCALENDAR\n";
    const { events } = parseIcs(text);
    expect(events[0].name).toBe("Sch\u00fctzenfest \u{1F3AF} mit langem Titel");
  });

  it("ignores VTIMEZONE and survives binary or truncated input", () => {
    const tz = [
      "BEGIN:VTIMEZONE",
      "TZID:X",
      "BEGIN:STANDARD",
      "DTSTART:19701025T030000",
      "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");
    expect(parseIcs(wrap(tz, vevent("SUMMARY:Ok", "DTSTART:20261001T190000"))).events).toHaveLength(
      1,
    );
    expect(parseIcs("\u0000\u0001\uFFFD\uFFFD PNG \u0089").events).toEqual([]);
    // truncated: no END:VEVENT -> nothing half-parsed
    expect(parseIcs("BEGIN:VEVENT\r\nSUMMARY:X\r\nDTSTART:20261001T190000").events).toEqual([]);
  });

  it("parses 5000 events quickly", () => {
    const many = wrap(
      ...Array.from({ length: 5000 }, (_, i) =>
        vevent(
          `UID:${i}`,
          `SUMMARY:Termin ${i % 50}`,
          "DTSTART:20261001T170000Z",
          "DTEND:20261001T190000Z",
        ),
      ),
    );
    const t = performance.now();
    const { events } = parseIcs(many, { timeZone: "Europe/Berlin" });
    expect(events).toHaveLength(5000);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

describe("round trip with the export (Phase 4)", () => {
  const base = {
    calendarId: "c",
    isDraft: false,
    locationId: null,
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
    timezone: "Europe/Berlin",
  } satisfies Partial<CalendarEvent>;
  const events: CalendarEvent[] = [
    {
      ...base,
      id: "1",
      name: "Training, Luftgewehr; Äpfel & Öl \\ Test",
      date: "2026-10-10",
      timeBegin: "19:00",
      timeEnd: "21:00",
    },
    {
      ...base,
      id: "2",
      name: "Frühschoppen",
      date: "2026-03-29",
      timeBegin: "01:30",
      timeEnd: "03:30",
    },
    {
      ...base,
      id: "3",
      name: "Meisterschaft",
      date: "2026-10-10",
      dateEnd: "2026-10-12",
      isAllDay: true,
      timeBegin: "00:00",
      timeEnd: "23:59",
    },
    {
      ...base,
      id: "4",
      name: "Zeltlager",
      date: "2026-07-10",
      dateEnd: "2026-07-12",
      timeBegin: "18:00",
      timeEnd: "10:00",
    },
    {
      ...base,
      id: "5",
      name: "Silvester",
      date: "2026-12-31",
      dateEnd: "2027-01-01",
      timeBegin: "22:00",
      timeEnd: "01:00",
    },
  ];

  it("imports the same events again", () => {
    const ics = buildIcs(events, {
      calendarName: "Verein",
      timeZone: "Europe/Berlin",
      labels: { features: "Features", targetGroups: "Zielgruppen" },
    });
    const { events: back, skipped } = parseIcs(ics, { timeZone: "Europe/Berlin" });
    expect(skipped).toEqual([]);
    expect(
      back.map(({ name, date, dateEnd, isAllDay, timeBegin, timeEnd }) => ({
        name,
        date,
        dateEnd,
        isAllDay,
        timeBegin,
        timeEnd,
      })),
    ).toEqual(
      events.map((e) => ({
        name: e.name,
        date: e.date,
        dateEnd: e.dateEnd ?? "",
        isAllDay: !!e.isAllDay,
        timeBegin: e.timeBegin,
        timeEnd: e.timeEnd,
      })),
    );
  });
});
