import { describe, expect, it } from "vitest";
import type { EventTemplate } from "@/lib/types";
import {
  emptyTemplateValues,
  isTemplateDirty,
  matchesTemplateQuery,
  toTemplatePayload,
  validateTemplate,
  valuesFromTemplateRecord,
} from "../form";

const tpl: EventTemplate = {
  id: "t1",
  calendarId: "k1",
  name: "Training Luftgewehr",
  timezone: "Europe/Berlin",
  timeBegin: "19:00:00",
  timeEnd: "21:00:00",
  locationId: "l1",
  location: { id: "l1", calendarid: "k1", name: "Schützenhaus Waldblick", city: "Musterstadt" },
  properties: [{ property: { id: "p1", calendarid: "k1", name: "Wettkampf", icon: "🏆" } }],
  features: [{ feature: { id: "f1", calendarid: "k1", name: "Bonusschießen" } }],
  targetGroups: [{ targetGroup: { id: "g1", calendarid: "k1", name: "Erwachsene" } }],
};

describe("template form values", () => {
  it("starts with default times and the club zone", () => {
    expect(emptyTemplateValues()).toMatchObject({
      name: "",
      useClubTimezone: true,
      timeBegin: "19:00",
      timeEnd: "21:00",
    });
  });

  it("maps a template and detects the club zone", () => {
    const v = valuesFromTemplateRecord(tpl, "Europe/Berlin");
    expect(v).toMatchObject({
      name: "Training Luftgewehr",
      useClubTimezone: true,
      timeBegin: "19:00",
      timeEnd: "21:00",
      locationId: "l1",
      propertyIds: ["p1"],
      featureIds: ["f1"],
      targetGroupIds: ["g1"],
    });
    expect(valuesFromTemplateRecord(tpl, "Europe/London").useClubTimezone).toBe(false);
    expect(valuesFromTemplateRecord(tpl, null).useClubTimezone).toBe(false);
  });
});

describe("validateTemplate", () => {
  it("requires a name and sane times", () => {
    const ok = { ...emptyTemplateValues(), name: "Training" };
    expect(validateTemplate(ok)).toEqual([]);
    expect(validateTemplate({ ...ok, name: "  " })).toEqual([
      { field: "name", code: "nameRequired" },
    ]);
    expect(validateTemplate({ ...ok, timeBegin: "", timeEnd: "" }).map((e) => e.code)).toEqual([
      "timeBeginRequired",
      "timeEndRequired",
    ]);
    expect(validateTemplate({ ...ok, timeBegin: "21:00", timeEnd: "19:00" })).toEqual([
      { field: "timeEnd", code: "timeEndBeforeStart" },
    ]);
  });
});

describe("toTemplatePayload", () => {
  it("sends the club zone or the chosen one, trimmed name and null for no location", () => {
    const v = { ...emptyTemplateValues(), name: " Training ", timezone: "Europe/London" };
    expect(toTemplatePayload(v, "Europe/Vienna")).toMatchObject({
      name: "Training",
      timezone: "Europe/Vienna",
      locationId: null,
    });
    expect(toTemplatePayload({ ...v, useClubTimezone: false }, "Europe/Vienna").timezone).toBe(
      "Europe/London",
    );
    expect(toTemplatePayload(v, null).timezone).toBe("Europe/London");
  });
});

describe("isTemplateDirty", () => {
  it("compares values, ignoring the zone select while the club zone is used", () => {
    const a = valuesFromTemplateRecord(tpl, "Europe/Berlin");
    expect(isTemplateDirty(a, { ...a })).toBe(false);
    expect(isTemplateDirty(a, { ...a, timezone: "Europe/London" })).toBe(false);
    expect(isTemplateDirty(a, { ...a, useClubTimezone: false })).toBe(true);
    expect(isTemplateDirty(a, { ...a, targetGroupIds: [] })).toBe(true);
    expect(isTemplateDirty(a, { ...a, featureIds: ["f1"], propertyIds: ["p1"] })).toBe(false);
  });
});

describe("matchesTemplateQuery", () => {
  it("searches name, place and tags", () => {
    expect(matchesTemplateQuery(tpl, "")).toBe(true);
    expect(matchesTemplateQuery(tpl, "luftgewehr")).toBe(true);
    expect(matchesTemplateQuery(tpl, "waldblick")).toBe(true);
    expect(matchesTemplateQuery(tpl, "bonus")).toBe(true);
    expect(matchesTemplateQuery(tpl, "erwachs")).toBe(true);
    expect(matchesTemplateQuery(tpl, "jugend")).toBe(false);
  });
});
