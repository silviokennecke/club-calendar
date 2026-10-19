import { describe, expect, it } from "vitest";
import { buildEventIcs, type IcsEvent } from "../ics";

const opts = {
  name: "Schießbetrieb",
  timeZone: "Europe/Berlin",
  labels: { features: "Zusatzangebote", targetGroups: "Gruppen" },
  now: new Date("2026-10-03T10:00:00Z"),
};

function ev(partial: Partial<IcsEvent> = {}): IcsEvent {
  return {
    id: "e-1",
    name: "Herbstfest",
    date: "2026-10-24",
    timeBegin: "15:00",
    timeEnd: "22:00",
    properties: [{ property: { icon: "🌳" } }],
    features: [{ feature: { name: "Getränkeverkauf" } }],
    targetGroups: [{ targetGroup: { name: "Jugend" } }, { targetGroup: { name: "Senioren" } }],
    location: {
      name: "Vereinsheim Mitte",
      street: "Marktplatz 5",
      zip: "12345",
      city: "Musterstadt",
      latitude: 50.5,
      longitude: 8.25,
    },
    ...partial,
  };
}

describe("buildEventIcs", () => {
  it("writes exactly one event with the feed's UID, zone-correct UTC times and place", () => {
    const ics = buildEventIcs(ev(), opts);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("UID:event-e-1@club-calendar");
    expect(ics).toContain("SUMMARY:🌳 Herbstfest");
    // 24.10.2026 is still summer time in Berlin (UTC+2)
    expect(ics).toContain("DTSTART:20261024T130000Z");
    expect(ics).toContain("DTEND:20261024T200000Z");
    expect(ics).toContain("LOCATION:Vereinsheim Mitte\\, Marktplatz 5\\, 12345 Musterstadt");
    expect(ics).toContain("GEO:50.5;8.25");
    expect(ics).toContain(
      "DESCRIPTION:Zusatzangebote: Getränkeverkauf\\nGruppen: Jugend\\, Senioren",
    );
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("uses date values for all-day and multi-day events (exclusive end day)", () => {
    const ics = buildEventIcs(
      ev({ isAllDay: true, dateEnd: "2026-10-26", location: null, features: [] }),
      opts,
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20261024");
    expect(ics).toContain("DTEND;VALUE=DATE:20261027");
    expect(ics).not.toContain("LOCATION");
  });

  it("writes floating local times when no zone is known at all", () => {
    const ics = buildEventIcs(ev(), { ...opts, timeZone: null });
    expect(ics).toContain("DTSTART:20261024T150000\r\n");
    expect(ics).toContain("DTEND:20261024T220000\r\n");
  });

  it("prefers the event's own zone and escapes text", () => {
    const ics = buildEventIcs(ev({ timezone: "UTC", name: "Fest; mit, Komma" }), opts);
    expect(ics).toContain("DTSTART:20261024T150000Z");
    expect(ics).toContain("Fest\\; mit\\, Komma");
  });

  it("writes the note first in DESCRIPTION, escaped, newlines as \\n", () => {
    const ics = buildEventIcs(
      ev({ note: "Treffpunkt: Halle; bitte pünktlich,\nDank!" }),
      opts,
    ).replace(/\r\n /g, "");
    expect(ics).toContain(
      "DESCRIPTION:Treffpunkt: Halle\\; bitte pünktlich\\,\\nDank!\\nZusatzangebote: Getränkeverkauf",
    );
    const only = buildEventIcs(ev({ note: "Nur Notiz", features: [], targetGroups: [] }), opts);
    expect(only).toContain("DESCRIPTION:Nur Notiz");
  });

  it("folds a long note to 75 octets per line", () => {
    const ics = buildEventIcs(ev({ note: "lang ".repeat(60) }), opts);
    for (const line of ics.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
