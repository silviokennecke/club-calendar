import { describe, expect, it } from "vitest";
import {
  applyTemplateToValues,
  emptyEventValues,
  isFormDirty,
  isMultiDayValues,
  NOTE_MAX,
  toEventPayload,
  validateEvent,
  valuesFromEvent,
  valuesFromTemplate,
  type EventFormValues,
} from "../form";
import { changedEventFields } from "../series";
import type { CalendarEvent, EventTemplate } from "@/lib/types";

function values(partial: Partial<EventFormValues> = {}): EventFormValues {
  return { ...emptyEventValues("2026-10-14"), name: "Training", ...partial };
}

const codes = (v: EventFormValues) => validateEvent(v).map((e) => `${e.field}:${e.code}`);

describe("validateEvent", () => {
  it("accepts a complete single-day event", () => {
    expect(validateEvent(values())).toEqual([]);
  });

  it("requires a name and a start date, in form order", () => {
    expect(codes(values({ name: "  ", date: "" }))).toEqual([
      "name:nameRequired",
      "date:dateRequired",
    ]);
  });

  it("rejects invalid dates", () => {
    expect(codes(values({ date: "2026-02-30" }))).toEqual(["date:dateInvalid"]);
    expect(codes(values({ dateEnd: "2026-13-01" }))).toEqual(["dateEnd:dateEndInvalid"]);
  });

  it("rejects an end date before the start date", () => {
    expect(codes(values({ dateEnd: "2026-10-13" }))).toEqual(["dateEnd:dateEndBeforeStart"]);
  });

  it("requires times unless the event is all-day", () => {
    expect(codes(values({ timeBegin: "", timeEnd: "" }))).toEqual([
      "timeBegin:timeBeginRequired",
      "timeEnd:timeEndRequired",
    ]);
    expect(validateEvent(values({ isAllDay: true, timeBegin: "", timeEnd: "" }))).toEqual([]);
  });

  it("rejects an end time before the start time on one day only", () => {
    expect(codes(values({ timeBegin: "20:00", timeEnd: "18:00" }))).toEqual([
      "timeEnd:timeEndBeforeStart",
    ]);
    // Multi-day: 20:00 on day one until 18:00 on day two is fine.
    expect(
      validateEvent(values({ timeBegin: "20:00", timeEnd: "18:00", dateEnd: "2026-10-15" })),
    ).toEqual([]);
  });
});

describe("toEventPayload", () => {
  it("builds the request body of a draft single-day event", () => {
    expect(toEventPayload(values({ name: " Training " }))).toEqual({
      name: "Training",
      date: "2026-10-14",
      dateEnd: null,
      isAllDay: false,
      timeBegin: "19:00",
      timeEnd: "21:00",
      isDraft: true,
      locationId: null,
      propertyIds: [],
      featureIds: [],
      targetGroupIds: [],
      note: "",
    });
  });

  it("keeps the end date only for multi-day events", () => {
    expect(toEventPayload(values({ dateEnd: "2026-10-14" })).dateEnd).toBeNull();
    expect(toEventPayload(values({ dateEnd: "2026-10-16" })).dateEnd).toBe("2026-10-16");
    expect(isMultiDayValues({ date: "2026-10-14", dateEnd: "2026-10-16" })).toBe(true);
  });

  it("sends whole-day times for all-day events without times", () => {
    const p = toEventPayload(values({ isAllDay: true, timeBegin: "", timeEnd: "" }));
    expect(p).toMatchObject({ isAllDay: true, timeBegin: "00:00", timeEnd: "23:59" });
  });

  it("publishes and assigns location, properties and template", () => {
    const p = toEventPayload(
      values({ status: "published", locationId: "l1", propertyIds: ["p1"], eventTemplateId: "t1" }),
    );
    expect(p).toMatchObject({
      isDraft: false,
      locationId: "l1",
      propertyIds: ["p1"],
      eventTemplateId: "t1",
    });
  });
});

const event: CalendarEvent = {
  id: "e1",
  calendarId: "k1",
  name: "Vereinsmeisterschaft",
  date: "2026-10-10",
  dateEnd: "2026-10-11",
  timeBegin: "09:00:00",
  timeEnd: "18:00",
  isAllDay: true,
  timezone: "Europe/Berlin",
  isDraft: false,
  locationId: "l1",
  location: null,
  eventTemplateId: null,
  properties: [{ property: { id: "p1", calendarid: "k1", name: "Wettkampf", icon: "🏆" } }],
  features: [{ feature: { id: "f1", calendarid: "k1", name: "Bonusschießen" } }],
  targetGroups: [{ targetGroup: { id: "g1", clubId: "k1", name: "Jugend" } }],
};

describe("valuesFromEvent", () => {
  it("maps a multi-day all-day event", () => {
    expect(valuesFromEvent(event)).toEqual({
      name: "Vereinsmeisterschaft",
      date: "2026-10-10",
      dateEnd: "2026-10-11",
      isAllDay: true,
      timeBegin: "09:00",
      timeEnd: "18:00",
      status: "published",
      locationId: "l1",
      propertyIds: ["p1"],
      featureIds: ["f1"],
      targetGroupIds: ["g1"],
      eventTemplateId: null,
      note: "",
    });
  });

  it("drops an end date equal to the start", () => {
    expect(valuesFromEvent({ ...event, dateEnd: "2026-10-10" }).dateEnd).toBe("");
  });
});

describe("valuesFromTemplate", () => {
  const tpl: EventTemplate = {
    id: "t1",
    calendarId: "k1",
    name: "Training Luftgewehr",
    timezone: "Europe/Berlin",
    timeBegin: "19:00",
    timeEnd: "21:00",
    locationId: "l1",
    location: null,
    properties: [{ property: { id: "p1", calendarid: "k1", name: "Wettkampf", icon: null } }],
    features: [],
    targetGroups: [
      { targetGroup: { id: "g2", clubId: "k1", name: "Erwachsene" } },
      { targetGroup: { id: "g3", clubId: "k1", name: "Senioren" } },
    ],
  };

  it("takes over name, times, location and assignments as a draft", () => {
    expect(valuesFromTemplate(tpl, "2026-10-15")).toEqual({
      name: "Training Luftgewehr",
      date: "2026-10-15",
      dateEnd: "",
      isAllDay: false,
      timeBegin: "19:00",
      timeEnd: "21:00",
      status: "draft",
      locationId: "l1",
      propertyIds: ["p1"],
      featureIds: [],
      targetGroupIds: ["g2", "g3"],
      eventTemplateId: "t1",
      note: "",
    });
  });

  it("ignores an invalid preset date", () => {
    expect(valuesFromTemplate(tpl, "kaputt").date).toBe("");
  });

  it("makes the event all-day when the template has no times", () => {
    const v = valuesFromTemplate({ ...tpl, timezone: null, timeBegin: null, timeEnd: null });
    expect(v.isAllDay).toBe(true);
    // the hidden time inputs keep usable defaults for switching all-day off
    expect(v.timeBegin).toMatch(/^\d\d:\d\d$/);
  });
});

describe("isFormDirty", () => {
  it("detects changes and ignores order of selections and hidden times", () => {
    const a = values({ propertyIds: ["p1", "p2"] });
    expect(isFormDirty(a, { ...a })).toBe(false);
    expect(isFormDirty(a, { ...a, propertyIds: ["p2", "p1"] })).toBe(false);
    expect(isFormDirty(a, { ...a, name: "Anders" })).toBe(true);
    expect(isFormDirty(a, { ...a, status: "published" })).toBe(true);
    const allDay = { ...a, isAllDay: true };
    expect(isFormDirty(allDay, { ...allDay, timeBegin: "08:00" })).toBe(false);
  });
});

describe("note", () => {
  it("is optional, limited to 2000 characters", () => {
    expect(codes(values({ note: "x".repeat(NOTE_MAX) }))).toEqual([]);
    expect(codes(values({ note: "x".repeat(NOTE_MAX + 1) }))).toEqual(["note:noteTooLong"]);
  });

  it("goes into the payload unchanged (newlines kept), empty meaning no note", () => {
    expect(toEventPayload(values({ note: "Zeile 1\nZeile 2" })).note).toBe("Zeile 1\nZeile 2");
    expect(toEventPayload(values()).note).toBe("");
  });

  it("is read from an event and a template, null meaning empty", () => {
    const ev = { ...baseEvent(), note: "Hinweis" } as CalendarEvent;
    expect(valuesFromEvent(ev).note).toBe("Hinweis");
    expect(valuesFromEvent({ ...ev, note: null }).note).toBe("");
    const tpl = {
      id: "t1",
      calendarId: "k1",
      name: "V",
      timezone: null,
      timeBegin: null,
      timeEnd: null,
      locationId: null,
      location: null,
      properties: [],
      features: [],
      targetGroups: [],
      note: "Aus der Vorlage",
    } satisfies EventTemplate;
    expect(valuesFromTemplate(tpl, "2026-10-14").note).toBe("Aus der Vorlage");
    expect(valuesFromTemplate({ ...tpl, note: undefined }).note).toBe("");
  });

  it("makes the form dirty and is a changed field for series scope all", () => {
    const a = values();
    const b = values({ note: "neu" });
    expect(isFormDirty(a, b)).toBe(true);
    expect(changedEventFields(toEventPayload(a), toEventPayload(b))).toEqual({ note: "neu" });
  });
});

function baseEvent() {
  return {
    id: "e1",
    calendarId: "k1",
    name: "Training",
    date: "2026-10-14",
    timeBegin: "19:00:00",
    timeEnd: "21:00:00",
    timezone: null,
    isDraft: false,
    locationId: null,
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
  };
}

describe("applyTemplateToValues", () => {
  const tpl: EventTemplate = {
    id: "t1",
    calendarId: "k1",
    name: "Training Luftgewehr",
    timezone: null,
    timeBegin: "18:30:00",
    timeEnd: "20:00:00",
    locationId: "l1",
    location: null,
    properties: [{ property: { id: "p1", calendarid: "k1", name: "Wettkampf", icon: null } }],
    features: [{ feature: { id: "f1", calendarid: "k1", name: "Bonus" } }],
    targetGroups: [{ targetGroup: { id: "g2", clubId: "k1", name: "Erwachsene" } }],
    note: "Bitte pünktlich",
  };
  const current = values({
    name: "Tra",
    date: "2026-10-20",
    dateEnd: "2026-10-21",
    status: "published",
    isAllDay: true,
    locationId: "l9",
    propertyIds: ["p9"],
    featureIds: ["f9"],
    targetGroupIds: ["g9"],
    note: "alt",
  });

  it("overwrites everything the template has and keeps dates and status", () => {
    expect(applyTemplateToValues(current, tpl)).toEqual({
      name: "Training Luftgewehr",
      date: "2026-10-20",
      dateEnd: "2026-10-21",
      status: "published",
      isAllDay: false,
      timeBegin: "18:30",
      timeEnd: "20:00",
      locationId: "l1",
      propertyIds: ["p1"],
      featureIds: ["f1"],
      targetGroupIds: ["g2"],
      eventTemplateId: "t1",
      note: "Bitte pünktlich",
    });
  });

  it("keeps existing values where the template has none", () => {
    const empty: EventTemplate = {
      ...tpl,
      timeBegin: null,
      timeEnd: null,
      locationId: null,
      location: null,
      properties: [],
      features: [],
      targetGroups: [],
      note: null,
    };
    expect(applyTemplateToValues(current, empty)).toEqual({
      ...current,
      name: "Training Luftgewehr",
      eventTemplateId: "t1",
    });
  });

  it("leaves the times alone when the template has only one of them", () => {
    const v = applyTemplateToValues(current, { ...tpl, timeEnd: null });
    expect(v.isAllDay).toBe(true);
    expect(v.timeBegin).toBe(current.timeBegin);
    expect(v.timeEnd).toBe(current.timeEnd);
  });

  it("takes the location from the embedded object", () => {
    const loc = { id: "l2" } as EventTemplate["location"];
    expect(
      applyTemplateToValues(current, { ...tpl, locationId: null, location: loc }).locationId,
    ).toBe("l2");
  });
});
