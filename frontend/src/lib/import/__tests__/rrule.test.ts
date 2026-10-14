import { describe, expect, it } from "vitest";
import { MAX_INSTANCES_PER_RULE, parseIcs, zonedToUtc } from "../ics";
import { IMPORT_MAX } from "../review";
import { parseRRule } from "../rrule";

// Expected dates were produced with ical.js 2 (RecurExpansion) in a scratch directory (not a project
// dependency); the one deliberate difference is noted at the leap-day case.

const wrap = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) =>
  ["BEGIN:VEVENT", "SUMMARY:Training", ...lines, "END:VEVENT"].join("\r\n");

/** Instances of one VEVENT as "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:MM" (start). */
function starts(lines: string[], timeZone = "Europe/Berlin"): string[] {
  return parseIcs(wrap(vevent("UID:u1", ...lines)), { timeZone }).events.map((e) =>
    e.isAllDay ? e.date : `${e.date}T${e.timeBegin}`,
  );
}

describe("RRULE expansion (vectors checked against ical.js)", () => {
  it("weekly on several weekdays with COUNT", () => {
    expect(
      starts(["DTSTART:20261005T190000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10"]),
    ).toEqual([
      "2026-10-05T19:00",
      "2026-10-07T19:00",
      "2026-10-09T19:00",
      "2026-10-12T19:00",
      "2026-10-14T19:00",
      "2026-10-16T19:00",
      "2026-10-19T19:00",
      "2026-10-21T19:00",
      "2026-10-23T19:00",
      "2026-10-26T19:00",
    ]);
  });

  it("weekly with INTERVAL and a UTC UNTIL", () => {
    expect(
      starts([
        "DTSTART:20261006T190000",
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261201T235959Z",
      ]),
    ).toEqual([
      "2026-10-06T19:00",
      "2026-10-08T19:00",
      "2026-10-20T19:00",
      "2026-10-22T19:00",
      "2026-11-03T19:00",
      "2026-11-05T19:00",
      "2026-11-17T19:00",
      "2026-11-19T19:00",
      "2026-12-01T19:00",
    ]);
  });

  it("WKST decides the week of INTERVAL=2 (RFC 5545 example)", () => {
    const rule = "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU";
    expect(starts(["DTSTART:19970805T090000", `${rule};WKST=MO`])).toEqual([
      "1997-08-05T09:00",
      "1997-08-10T09:00",
      "1997-08-19T09:00",
      "1997-08-24T09:00",
    ]);
    expect(starts(["DTSTART:19970805T090000", `${rule};WKST=SU`])).toEqual([
      "1997-08-05T09:00",
      "1997-08-17T09:00",
      "1997-08-19T09:00",
      "1997-08-31T09:00",
    ]);
  });

  it("daily with INTERVAL and on weekdays only", () => {
    expect(starts(["DTSTART:20261001T080000", "RRULE:FREQ=DAILY;INTERVAL=3;COUNT=5"])).toEqual([
      "2026-10-01T08:00",
      "2026-10-04T08:00",
      "2026-10-07T08:00",
      "2026-10-10T08:00",
      "2026-10-13T08:00",
    ]);
    expect(
      starts([
        "DTSTART;VALUE=DATE:20261026",
        "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261106",
      ]),
    ).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
  });

  it("monthly on the n-th, last and fifth weekday", () => {
    expect(starts(["DTSTART:20261012T190000", "RRULE:FREQ=MONTHLY;BYDAY=2MO;COUNT=6"])).toEqual([
      "2026-10-12T19:00",
      "2026-11-09T19:00",
      "2026-12-14T19:00",
      "2027-01-11T19:00",
      "2027-02-08T19:00",
      "2027-03-08T19:00",
    ]);
    expect(starts(["DTSTART:20261030T190000", "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=6"])).toEqual([
      "2026-10-30T19:00",
      "2026-11-27T19:00",
      "2026-12-25T19:00",
      "2027-01-29T19:00",
      "2027-02-26T19:00",
      "2027-03-26T19:00",
    ]);
    // Only months with five Tuesdays
    expect(starts(["DTSTART:20260929T190000", "RRULE:FREQ=MONTHLY;BYDAY=5TU;COUNT=4"])).toEqual([
      "2026-09-29T19:00",
      "2026-12-29T19:00",
      "2027-03-30T19:00",
      "2027-06-29T19:00",
    ]);
  });

  it("monthly by day of month: invalid days are skipped, negative days count from the end", () => {
    expect(starts(["DTSTART;VALUE=DATE:20261031", "RRULE:FREQ=MONTHLY;COUNT=5"])).toEqual([
      "2026-10-31",
      "2026-12-31",
      "2027-01-31",
      "2027-03-31",
      "2027-05-31",
    ]);
    expect(
      starts(["DTSTART;VALUE=DATE:20261031", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4"]),
    ).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
    expect(
      starts([
        "DTSTART;VALUE=DATE:20261001",
        "RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15;COUNT=6",
      ]),
    ).toEqual(["2026-10-01", "2026-10-15", "2026-12-01", "2026-12-15", "2027-02-01", "2027-02-15"]);
  });

  it("yearly: leap day only in leap years, n-th weekday of BYMONTH, several months", () => {
    // RFC 5545 3.3.10: invalid dates (29 Feb 2029) are ignored. ical.js moves them to 1 March;
    // the import follows the RFC.
    expect(starts(["DTSTART;VALUE=DATE:20280229", "RRULE:FREQ=YEARLY;COUNT=3"])).toEqual([
      "2028-02-29",
      "2032-02-29",
      "2036-02-29",
    ]);
    expect(
      starts(["DTSTART:20260329T100000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU;COUNT=3"]),
    ).toEqual(["2026-03-29T10:00", "2027-03-28T10:00", "2028-03-26T10:00"]);
    expect(
      starts(["DTSTART;VALUE=DATE:20270101", "RRULE:FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=1;COUNT=4"]),
    ).toEqual(["2027-01-01", "2027-07-01", "2028-01-01", "2028-07-01"]);
  });

  it("EXDATE (several values and lines, also DATE) and RDATE", () => {
    // COUNT counts the excluded instances too
    expect(
      starts([
        "DTSTART:20261005T190000",
        "RRULE:FREQ=WEEKLY;COUNT=6",
        "EXDATE:20261012T190000,20261026T190000",
        "EXDATE:20261102T190000",
      ]),
    ).toEqual(["2026-10-05T19:00", "2026-10-19T19:00", "2026-11-09T19:00"]);
    expect(
      starts([
        "DTSTART;VALUE=DATE:20261005",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;VALUE=DATE:20261019",
      ]),
    ).toEqual(["2026-10-05", "2026-10-12", "2026-10-26"]);
    expect(
      starts([
        "DTSTART:20261005T190000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "RDATE:20261008T190000,20261030T190000",
      ]),
    ).toEqual([
      "2026-10-05T19:00",
      "2026-10-08T19:00",
      "2026-10-12T19:00",
      "2026-10-19T19:00",
      "2026-10-30T19:00",
    ]);
    // A UTC EXDATE matches the zoned instance; RDATE without RRULE
    expect(
      starts([
        "DTSTART;TZID=Europe/Berlin:20261005T190000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "EXDATE:20261012T170000Z",
      ]),
    ).toEqual(["2026-10-05T19:00", "2026-10-19T19:00"]);
    expect(starts(["DTSTART;VALUE=DATE:20261005", "RDATE;VALUE=DATE:20261010,20261020"])).toEqual([
      "2026-10-05",
      "2026-10-10",
      "2026-10-20",
    ]);
  });

  it("an UNTIL date-time exactly at an instance ends inclusively (UTC, zoned, floating)", () => {
    expect(starts(["DTSTART:20261001T100000Z", "RRULE:FREQ=DAILY;UNTIL=20261003T100000Z"])).toEqual(
      ["2026-10-01T12:00", "2026-10-02T12:00", "2026-10-03T12:00"],
    );
    expect(
      starts([
        "DTSTART;TZID=Europe/Berlin:20261001T100000",
        "RRULE:FREQ=DAILY;UNTIL=20261003T080000Z",
      ]),
    ).toEqual(["2026-10-01T10:00", "2026-10-02T10:00", "2026-10-03T10:00"]);
    expect(starts(["DTSTART:20261001T100000", "RRULE:FREQ=DAILY;UNTIL=20261003T100000"])).toEqual([
      "2026-10-01T10:00",
      "2026-10-02T10:00",
      "2026-10-03T10:00",
    ]);
    // One minute earlier ends the day before
    expect(starts(["DTSTART:20261001T100000Z", "RRULE:FREQ=DAILY;UNTIL=20261003T095959Z"])).toEqual(
      ["2026-10-01T12:00", "2026-10-02T12:00"],
    );
  });

  it("an UNTIL date ends inclusively", () => {
    expect(starts(["DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=WEEKLY;UNTIL=20261022"])).toEqual([
      "2026-10-01",
      "2026-10-08",
      "2026-10-15",
      "2026-10-22",
    ]);
  });
});

describe("RRULE times", () => {
  it("keeps the wall-clock time of a zoned DTSTART over the daylight saving changes", () => {
    const march = parseIcs(
      wrap(
        vevent(
          "UID:m",
          "DTSTART;TZID=Europe/Berlin:20260322T100000",
          "DTEND;TZID=Europe/Berlin:20260322T120000",
          "RRULE:FREQ=WEEKLY;COUNT=3",
        ),
      ),
      { timeZone: "Europe/Berlin" },
    ).events;
    expect(march.map((e) => [e.date, e.timeBegin, e.timeEnd, e.timezone])).toEqual([
      ["2026-03-22", "10:00", "12:00", "Europe/Berlin"],
      ["2026-03-29", "10:00", "12:00", "Europe/Berlin"],
      ["2026-04-05", "10:00", "12:00", "Europe/Berlin"],
    ]);
    expect(
      starts(["DTSTART;TZID=Europe/Berlin:20261018T190000", "RRULE:FREQ=WEEKLY;COUNT=3"]),
    ).toEqual(["2026-10-18T19:00", "2026-10-25T19:00", "2026-11-01T19:00"]);
  });

  it("iterates a UTC DTSTART in UTC: the wall-clock time moves with daylight saving", () => {
    const events = parseIcs(
      wrap(
        vevent(
          "UID:utc",
          "DTSTART:20261018T080000Z",
          "DTEND:20261018T100000Z",
          "RRULE:FREQ=WEEKLY;COUNT=3",
        ),
      ),
      { timeZone: "Europe/Berlin" },
    ).events;
    // 08:00 UTC = 10:00 summer time, 09:00 winter time (from 25 October 2026)
    expect(events.map((e) => [e.date, e.timeBegin, e.timeEnd])).toEqual([
      ["2026-10-18", "10:00", "12:00"],
      ["2026-10-25", "09:00", "11:00"],
      ["2026-11-01", "09:00", "11:00"],
    ]);
  });

  it("instances of all-day and multi-day events keep their length", () => {
    const events = parseIcs(
      wrap(
        vevent(
          "UID:camp",
          "DTSTART;VALUE=DATE:20261030",
          "DTEND;VALUE=DATE:20261102",
          "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2",
        ),
        vevent(
          "UID:night",
          "DTSTART;TZID=Europe/Berlin:20261003T220000",
          "DTEND;TZID=Europe/Berlin:20261004T020000",
          "RRULE:FREQ=WEEKLY;COUNT=2",
        ),
      ),
      { timeZone: "Europe/Berlin" },
    ).events;
    expect(events.map((e) => [e.date, e.dateEnd, e.isAllDay, e.timeBegin, e.timeEnd])).toEqual([
      ["2026-10-30", "2026-11-01", true, "00:00", "23:59"],
      ["2026-11-27", "2026-11-29", true, "00:00", "23:59"],
      ["2026-10-03", "2026-10-04", false, "22:00", "02:00"],
      ["2026-10-10", "2026-10-11", false, "22:00", "02:00"],
    ]);
  });

  it("converts zoned wall-clock times to UTC", () => {
    expect(zonedToUtc("2026-10-25", "02:30", "Europe/Berlin").time).toBe("01:30");
    expect(zonedToUtc("2026-07-01", "19:00", "Europe/Berlin")).toEqual({
      date: "2026-07-01",
      time: "17:00",
    });
    expect(zonedToUtc("2026-01-01", "00:30", "Europe/Berlin")).toEqual({
      date: "2025-12-31",
      time: "23:30",
    });
  });
});

describe("RRULE instances in the import", () => {
  it("gives each instance its own UID and marks the recurrence", () => {
    const { events, recurrence } = parseIcs(
      wrap(vevent("UID:abc@x", "DTSTART;VALUE=DATE:20261005", "RRULE:FREQ=WEEKLY;COUNT=3")),
    );
    expect(events.map((e) => e.uid)).toEqual([
      "abc@x#20261005",
      "abc@x#20261012",
      "abc@x#20261019",
    ]);
    expect(events.every((e) => e.recurring && e.recurrenceKey === "abc@x")).toBe(true);
    expect(recurrence).toMatchObject({ rules: 1, instances: 3, capped: 0, unbounded: 0 });
    // A file without UID invents none
    const noUid = parseIcs(
      wrap(vevent("DTSTART:20261010T180000", "RRULE:FREQ=WEEKLY;COUNT=2")),
    ).events;
    expect(noUid.map((e) => e.uid)).toEqual(["", ""]);
    expect(noUid[0].recurring).toBe(true);
  });

  it("long UIDs are shortened to 255 characters and stay different", () => {
    const uidsOf = (uid: string) =>
      parseIcs(
        wrap(vevent(`UID:${uid}`, "DTSTART;VALUE=DATE:20261005", "RRULE:FREQ=DAILY;COUNT=1")),
      ).events[0].uid;
    const prefix = "x".repeat(250);
    const a = uidsOf(`${prefix}-a`);
    const b = uidsOf(`${prefix}-b`);
    expect(a).not.toBe(b);
    expect(a.length).toBe(255);
    expect(a.endsWith("#20261005")).toBe(true);
    expect(uidsOf(`${prefix}-a`)).toBe(a); // stable for a later import
    // Exactly 246 characters stay as they are; emoji are never split
    expect(uidsOf("y".repeat(246))).toBe(`${"y".repeat(246)}#20261005`);
    const emoji = uidsOf("😀".repeat(300));
    expect(Array.from(emoji)).toHaveLength(255);
    expect(emoji.startsWith("😀".repeat(237) + "~")).toBe(true);
  });

  it("the UID of a UTC instance carries its date in the calendar's zone", () => {
    const { events } = parseIcs(
      wrap(vevent("UID:late", "DTSTART:20261009T230000Z", "RRULE:FREQ=DAILY;COUNT=2")),
      { timeZone: "Europe/Berlin" },
    );
    expect(events.map((e) => [e.date, e.timeBegin, e.uid])).toEqual([
      ["2026-10-10", "01:00", "late#20261010"],
      ["2026-10-11", "01:00", "late#20261011"],
    ]);
  });

  it("replaces an instance by its RECURRENCE-ID entry instead of importing it twice", () => {
    const { events } = parseIcs(
      wrap(
        vevent(
          "UID:tr",
          "DTSTART;TZID=Europe/Berlin:20261005T190000",
          "DTEND;TZID=Europe/Berlin:20261005T210000",
          "RRULE:FREQ=WEEKLY;COUNT=3",
        ),
        [
          "BEGIN:VEVENT",
          "UID:tr",
          "SUMMARY:Training (verlegt)",
          "RECURRENCE-ID;TZID=Europe/Berlin:20261012T190000",
          "DTSTART;TZID=Europe/Berlin:20261013T180000",
          "DTEND;TZID=Europe/Berlin:20261013T200000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      { timeZone: "Europe/Berlin" },
    );
    expect(events.map((e) => [e.name, e.date, e.timeBegin, e.uid])).toEqual([
      ["Training", "2026-10-05", "19:00", "tr#20261005"],
      ["Training (verlegt)", "2026-10-13", "18:00", "tr#20261012"],
      ["Training", "2026-10-19", "19:00", "tr#20261019"],
    ]);
    expect(events.every((e) => e.recurrenceKey === "tr")).toBe(true);
  });

  it("imports a RECURRENCE-ID entry without its series once", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:lonely",
          "SUMMARY:Ausnahme",
          "RECURRENCE-ID;VALUE=DATE:20261012",
          "DTSTART;VALUE=DATE:20261013",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(events.map((e) => [e.date, e.uid, e.recurring])).toEqual([
      ["2026-10-13", "lonely#20261012", false],
    ]);
  });

  it("caps a rule at 366 instances and limits rules without end to two years", () => {
    const daily = parseIcs(
      wrap(vevent("UID:d", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=1000")),
    );
    expect(daily.events).toHaveLength(MAX_INSTANCES_PER_RULE);
    expect(daily.recurrence).toMatchObject({ capped: 1, unbounded: 0 });

    const weekly = parseIcs(
      wrap(vevent("UID:w", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=WEEKLY")),
    );
    // Two years from the first event (before 2028-10-01)
    expect(weekly.events).toHaveLength(105);
    expect(weekly.events.at(-1)?.date).toBe("2028-09-28");
    expect(weekly.recurrence).toMatchObject({ unbounded: 1, capped: 0 });

    const endlessDaily = parseIcs(
      wrap(vevent("UID:e", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=DAILY")),
    );
    expect(endlessDaily.events).toHaveLength(366);
    expect(endlessDaily.recurrence).toMatchObject({ unbounded: 1, capped: 1 });
  });

  it("keeps at most IMPORT_MAX events per file: later instances give way, first ones stay", () => {
    const rules = Array.from({ length: 15 }, (_, i) =>
      vevent(`UID:r${i}`, "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=366"),
    );
    const singles = Array.from({ length: 3 }, (_, i) =>
      vevent(`UID:s${i}`, "DTSTART;VALUE=DATE:20260201"),
    );
    const { events, recurrence } = parseIcs(wrap(...rules, ...singles));
    expect(events).toHaveLength(IMPORT_MAX);
    expect(recurrence.dropped).toBe(15 * 366 + 3 - IMPORT_MAX);
    expect(recurrence.instances).toBe(IMPORT_MAX - 3);
    // Every rule keeps its first event, single events are never dropped
    for (let i = 0; i < 15; i += 1)
      expect(events.some((e) => e.uid === `r${i}#20260101`)).toBe(true);
    expect(events.filter((e) => !e.recurring)).toHaveLength(3);
  });

  it("expands 5000 instances in well under a second", () => {
    const rules = Array.from({ length: 14 }, (_, i) =>
      vevent(
        `UID:p${i}`,
        "DTSTART:20260101T080000Z",
        "DTEND:20260101T100000Z",
        "RRULE:FREQ=DAILY;COUNT=366",
        "EXDATE:20260105T080000Z",
      ),
    );
    const t0 = performance.now();
    const { events } = parseIcs(wrap(...rules), { timeZone: "Europe/Berlin" });
    const ms = performance.now() - t0;
    expect(events).toHaveLength(IMPORT_MAX);
    expect(ms).toBeLessThan(1000);
  });
});

describe("unsupported and broken rules", () => {
  it("a rule without end near the year 9999 stops at the last storable day", () => {
    const dates = starts(["DTSTART;VALUE=DATE:99991229", "RRULE:FREQ=DAILY"]);
    expect(dates).toEqual(["9999-12-29", "9999-12-30"]);
  });

  it.each([
    "FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1",
    "FREQ=DAILY;BYHOUR=9,17",
    "FREQ=HOURLY;COUNT=5",
    "FREQ=MINUTELY",
    "FREQ=YEARLY;BYWEEKNO=20",
    "FREQ=YEARLY;BYYEARDAY=100",
    "FREQ=YEARLY;BYDAY=20MO",
  ])("keeps only the first event of %s and flags it", (rule) => {
    const { events, recurrence } = parseIcs(
      wrap(vevent("UID:x", "DTSTART:20261005T190000", `RRULE:${rule}`)),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "x",
      date: "2026-10-05",
      recurring: false,
      recurrenceUnsupported: true,
    });
    expect(recurrence).toMatchObject({ unsupported: 1, rules: 0 });
  });

  it.each([
    "",
    "COUNT=3",
    "FREQ=WEEKLY;COUNT=0",
    "FREQ=WEEKLY;BYDAY=XX",
    "FREQ=FOO",
    "FREQ=WEEKLY;UNTIL=2026",
    "FREQ=WEEKLY;COUNT=2;UNTIL=20261231",
    "FREQ=WEEKLY;BYDAY=2MO",
    "FREQ=WEEKLY;INTERVAL=-1",
    "FREQ=MONTHLY;BYMONTHDAY=32",
    "FREQ=DAILY;FOO=1",
  ])("does not crash on the broken rule %j", (rule) => {
    expect(parseRRule(rule).ok).toBe(false);
    const { events } = parseIcs(wrap(vevent("UID:x", "DTSTART:20261005T190000", `RRULE:${rule}`)));
    expect(events).toHaveLength(1);
    expect(events[0].recurrenceUnsupported).toBe(true);
  });

  it("stops a rule that never matches", () => {
    const { events } = parseIcs(
      wrap(
        vevent(
          "UID:never",
          "DTSTART;VALUE=DATE:20260115",
          "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30;COUNT=5",
        ),
      ),
    );
    expect(events.map((e) => e.date)).toEqual(["2026-01-15"]);
  });
});
