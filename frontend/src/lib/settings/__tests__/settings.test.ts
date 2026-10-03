import { describe, expect, it } from "vitest";
import {
  EMPTY_LOCATION_FORM,
  countLocationUsage,
  countUsage,
  fillEmptyAddress,
  formatClock,
  formatFetched,
  isIcsUrl,
  locationFormValid,
  locationPayload,
  parseCoordinate,
  placeTitle,
  sameLocationForm,
  timeZoneList,
  validateHolidayForm,
  validateName,
} from "..";

const items = [
  { id: "a", name: "Jugend" },
  { id: "b", name: "Erwachsene" },
];

describe("validateName", () => {
  it("requires a name", () => {
    expect(validateName("   ", items)).toBe("empty");
  });
  it("rejects duplicates case-insensitively, but not the item itself", () => {
    expect(validateName(" jugend ", items)).toBe("duplicate");
    expect(validateName("Jugend", items, "a")).toBeNull();
    expect(validateName("Senioren", items)).toBeNull();
  });
});

describe("countUsage", () => {
  const events = [
    { properties: [{ property: { id: "p1" } }], features: [], targetGroups: [] },
    { properties: [], features: [{ feature: { id: "f1" } }], targetGroups: [] },
    {
      properties: [{ property: { id: "p1" } }],
      features: [],
      targetGroups: [{ targetGroup: { id: "g1" } }],
    },
  ] as never[];
  const templates = [
    { properties: [], features: [], targetGroups: [{ targetGroup: { id: "g1" } }] },
  ] as never[];

  it("counts events and templates per kind", () => {
    expect(countUsage("properties", "p1", events, templates)).toEqual({ events: 2, templates: 0 });
    expect(countUsage("features", "f1", events, templates)).toEqual({ events: 1, templates: 0 });
    expect(countUsage("audiences", "g1", events, templates)).toEqual({ events: 1, templates: 1 });
    expect(countUsage("audiences", "none", events, templates)).toEqual({ events: 0, templates: 0 });
  });

  it("counts a location's events and templates", () => {
    const evs = [{ locationId: "l1" }, { locationId: null }, { locationId: "l1" }];
    expect(countLocationUsage("l1", evs, [{ locationId: "l1" }, { locationId: "l2" }])).toEqual({
      events: 2,
      templates: 1,
    });
  });
});

describe("location form", () => {
  it("needs a name or a street", () => {
    expect(locationFormValid(EMPTY_LOCATION_FORM)).toBe(false);
    expect(locationFormValid({ ...EMPTY_LOCATION_FORM, street: "Waldstraße 12" })).toBe(true);
    expect(locationFormValid({ ...EMPTY_LOCATION_FORM, name: " Vereinsheim " })).toBe(true);
  });

  it("turns empty fields into null and only sends complete positions", () => {
    const payload = locationPayload({
      ...EMPTY_LOCATION_FORM,
      name: " Haus ",
      latitude: 48.1,
      longitude: null,
    });
    expect(payload).toEqual({
      name: "Haus",
      street: null,
      zip: null,
      city: null,
      country: null,
      latitude: null,
      longitude: null,
    });
    expect(
      locationPayload({ ...EMPTY_LOCATION_FORM, name: "x", latitude: 48.1, longitude: 11.5 }),
    ).toMatchObject({ latitude: 48.1, longitude: 11.5 });
  });

  it("fills only empty address fields from a picked position", () => {
    const { form, filled } = fillEmptyAddress(
      { ...EMPTY_LOCATION_FORM, street: "Eigene Straße" },
      { street: "Andere Straße", zip: "12345", city: "Musterstadt", country: null },
    );
    expect(form.street).toBe("Eigene Straße");
    expect(form.zip).toBe("12345");
    expect(form.city).toBe("Musterstadt");
    expect(filled).toEqual(["zip", "city"]);
  });

  it("compares forms ignoring surrounding whitespace", () => {
    expect(
      sameLocationForm(
        { ...EMPTY_LOCATION_FORM, name: "A" },
        { ...EMPTY_LOCATION_FORM, name: " A " },
      ),
    ).toBe(true);
    expect(
      sameLocationForm(EMPTY_LOCATION_FORM, { ...EMPTY_LOCATION_FORM, latitude: 1, longitude: 2 }),
    ).toBe(false);
  });

  it("titles a place by name, else street", () => {
    expect(placeTitle({ name: "Haus", street: "Weg 1" })).toBe("Haus");
    expect(placeTitle({ name: null, street: "Weg 1" })).toBe("Weg 1");
    expect(placeTitle({})).toBeNull();
  });

  it("parses typed coordinates", () => {
    expect(parseCoordinate("48,1371", 90)).toBe(48.1371);
    expect(parseCoordinate(" -11.5 ", 180)).toBe(-11.5);
    expect(parseCoordinate("", 90)).toBeNull();
    expect(parseCoordinate("abc", 90)).toBeNull();
    expect(parseCoordinate("95", 90)).toBeNull();
  });
});

describe("holiday form", () => {
  it("accepts http(s) addresses only", () => {
    expect(isIcsUrl("https://feiertage.example/de.ics")).toBe(true);
    expect(isIcsUrl("webcal://x/y.ics")).toBe(false);
    expect(isIcsUrl("feiertage")).toBe(false);
  });
  it("reports what is missing", () => {
    expect(validateHolidayForm("", "")).toEqual({ name: "empty", url: "empty" });
    expect(validateHolidayForm("Feiertage", "nope")).toEqual({ url: "invalid" });
    expect(validateHolidayForm("Feiertage", "https://a.example/x.ics")).toEqual({});
  });
});

describe("time zones", () => {
  it("lists zones and adds an unknown own zone", () => {
    const zones = timeZoneList("Mars/Olympus");
    expect(zones[0]).toBe("Mars/Olympus");
    expect(zones).toContain("Europe/Berlin");
    expect(zones).toContain("UTC");
  });

  it("formats the time and date in a zone", () => {
    const now = new Date("2026-10-02T12:32:00Z");
    expect(formatClock(now, "Europe/Berlin", "de")).toEqual({
      time: "14:32",
      date: "Fr 02.10.2026",
    });
    expect(formatClock(now, "Asia/Tokyo", "de")?.time).toBe("21:32");
    expect(formatClock(now, "Nowhere/Land", "de")).toBeNull();
  });

  it("formats the last fetch in the calendar's zone", () => {
    expect(formatFetched("2026-10-01T04:12:00Z", "Europe/Berlin", "de")).toBe("01.10.2026, 06:12");
    expect(formatFetched("garbage", null, "de")).toBe("");
  });
});
