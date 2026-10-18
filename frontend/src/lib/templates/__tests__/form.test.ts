import { describe, expect, it } from "vitest";
import type { EventTemplate } from "@/lib/types";
import {
  emptyTemplateValues,
  isTemplateDirty,
  matchesTemplateQuery,
  templateDeleteConsequence,
  templateTimes,
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
  location: { id: "l1", clubId: "k1", name: "Schützenhaus Waldblick", city: "Musterstadt" },
  properties: [{ property: { id: "p1", calendarid: "k1", name: "Wettkampf", icon: "🏆" } }],
  features: [{ feature: { id: "f1", calendarid: "k1", name: "Bonusschießen" } }],
  targetGroups: [{ targetGroup: { id: "g1", clubId: "k1", name: "Erwachsene" } }],
};

describe("template form values", () => {
  it("starts empty (no times) with the club zone (design: new templates start empty)", () => {
    expect(emptyTemplateValues()).toMatchObject({
      name: "",
      useClubTimezone: true,
      timeBegin: "",
      timeEnd: "",
    });
  });

  it("maps a template without times or zone", () => {
    const v = valuesFromTemplateRecord(
      { ...tpl, timezone: null, timeBegin: null, timeEnd: null },
      "Europe/Berlin",
    );
    expect(v).toMatchObject({ useClubTimezone: true, timeBegin: "", timeEnd: "" });
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
  it("requires a name; times are optional but come in pairs and in order", () => {
    const ok = { ...emptyTemplateValues(), name: "Training" };
    expect(validateTemplate(ok)).toEqual([]);
    expect(validateTemplate({ ...ok, timeBegin: "19:00", timeEnd: "21:00" })).toEqual([]);
    expect(validateTemplate({ ...ok, name: "  " })).toEqual([
      { field: "name", code: "nameRequired" },
    ]);
    expect(validateTemplate({ ...ok, timeBegin: "19:00" })).toEqual([
      { field: "timeEnd", code: "timeEndRequired" },
    ]);
    expect(validateTemplate({ ...ok, timeEnd: "21:00" })).toEqual([
      { field: "timeBegin", code: "timeBeginRequired" },
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

  it("sends null times for a template without times (all-day events)", () => {
    const v = { ...emptyTemplateValues(), name: "Fest" };
    expect(toTemplatePayload(v, "Europe/Berlin")).toMatchObject({ timeBegin: null, timeEnd: null });
    expect(toTemplatePayload({ ...v, timeBegin: "19:00", timeEnd: "21:00" }, null)).toMatchObject({
      timeBegin: "19:00",
      timeEnd: "21:00",
    });
  });
});

describe("templateTimes / templateDeleteConsequence", () => {
  it("gives HH:MM times or null without times", () => {
    expect(templateTimes(tpl)).toEqual({ from: "19:00", to: "21:00" });
    expect(templateTimes({ timeBegin: null, timeEnd: null })).toBeNull();
  });

  it("names how many events came from the template", () => {
    const t = (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${String(opts.count)}` : key;
    expect(templateDeleteConsequence({ eventCount: 4 }, t)).toBe(
      "templates.delete.consequenceCount:4",
    );
    expect(templateDeleteConsequence({ eventCount: 0 }, t)).toBe(
      "templates.delete.consequenceNone",
    );
    expect(templateDeleteConsequence({}, t)).toBe("templates.delete.consequence");
    expect(templateDeleteConsequence(undefined, t)).toBe("templates.delete.consequence");
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
