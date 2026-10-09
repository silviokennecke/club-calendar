/**
 * Template form: values, validation and the request body (pure, no React).
 * Mirrors lib/events/form.ts; times are "HH:MM" as the native inputs deliver them. Times are optional
 * (design: TemplateEdit, new templates start empty): a template without times creates all-day events.
 */
import type { EventTemplate } from "@/lib/types";

export interface TemplateFormValues {
  name: string;
  /** Use the club's time zone (the template then follows the club). */
  useClubTimezone: boolean;
  /** Only used when `useClubTimezone` is off. */
  timezone: string;
  /** Both empty: events from the template are all-day. */
  timeBegin: string;
  timeEnd: string;
  /** Empty = no default location. */
  locationId: string;
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
}

const FALLBACK_TIMEZONE = "Europe/Berlin";
/** Zones offered in the select (design: TemplateEdit); the current value is added if missing. */
export const TIMEZONES = [
  "Europe/Berlin",
  "Europe/London",
  "Europe/Vienna",
  "Europe/Zurich",
  "America/New_York",
];

export function emptyTemplateValues(): TemplateFormValues {
  return {
    name: "",
    useClubTimezone: true,
    timezone: FALLBACK_TIMEZONE,
    timeBegin: "",
    timeEnd: "",
    locationId: "",
    propertyIds: [],
    featureIds: [],
    targetGroupIds: [],
  };
}

function shortTime(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** Form values of an existing template. */
export function valuesFromTemplateRecord(
  tpl: EventTemplate,
  clubTimezone: string | null,
): TemplateFormValues {
  return {
    name: tpl.name,
    // A template without own zone follows the calendar / club
    useClubTimezone: !tpl.timezone || (!!clubTimezone && tpl.timezone === clubTimezone),
    timezone: tpl.timezone || FALLBACK_TIMEZONE,
    timeBegin: shortTime(tpl.timeBegin),
    timeEnd: shortTime(tpl.timeEnd),
    locationId: tpl.locationId ?? tpl.location?.id ?? "",
    propertyIds: tpl.properties.map((p) => p.property.id),
    featureIds: tpl.features.map((f) => f.feature.id),
    targetGroupIds: tpl.targetGroups.map((g) => g.targetGroup.id),
  };
}

export type TemplateField = "name" | "timeBegin" | "timeEnd";
export type TemplateErrorCode =
  "nameRequired" | "timeBeginRequired" | "timeEndRequired" | "timeEndBeforeStart";

export interface TemplateFormError {
  field: TemplateField;
  code: TemplateErrorCode;
}

/**
 * All problems in display order (top to bottom of the form). Times are optional but come in pairs:
 * both empty (all-day events) or both set.
 */
export function validateTemplate(v: TemplateFormValues): TemplateFormError[] {
  const errors: TemplateFormError[] = [];
  if (!v.name.trim()) errors.push({ field: "name", code: "nameRequired" });
  if (!v.timeBegin && v.timeEnd) errors.push({ field: "timeBegin", code: "timeBeginRequired" });
  if (v.timeBegin && !v.timeEnd) errors.push({ field: "timeEnd", code: "timeEndRequired" });
  if (v.timeBegin && v.timeEnd && v.timeEnd < v.timeBegin)
    errors.push({ field: "timeEnd", code: "timeEndBeforeStart" });
  return errors;
}

export interface TemplatePayload {
  name: string;
  timezone: string;
  /** null (both): events from the template are all-day. */
  timeBegin: string | null;
  timeEnd: string | null;
  locationId: string | null;
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
}

/** Request body for POST / PATCH; `clubTimezone` is sent when the club's zone is used. */
export function toTemplatePayload(
  v: TemplateFormValues,
  clubTimezone: string | null,
): TemplatePayload {
  return {
    name: v.name.trim(),
    timezone: v.useClubTimezone ? (clubTimezone ?? v.timezone) : v.timezone,
    timeBegin: v.timeBegin || null,
    timeEnd: v.timeEnd || null,
    locationId: v.locationId || null,
    propertyIds: v.propertyIds,
    featureIds: v.featureIds,
    targetGroupIds: v.targetGroupIds,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function isTemplateDirty(initial: TemplateFormValues, current: TemplateFormValues): boolean {
  return (
    initial.name !== current.name ||
    initial.useClubTimezone !== current.useClubTimezone ||
    (!current.useClubTimezone && initial.timezone !== current.timezone) ||
    initial.timeBegin !== current.timeBegin ||
    initial.timeEnd !== current.timeEnd ||
    initial.locationId !== current.locationId ||
    !sameSet(initial.propertyIds, current.propertyIds) ||
    !sameSet(initial.featureIds, current.featureIds) ||
    !sameSet(initial.targetGroupIds, current.targetGroupIds)
  );
}

/** Whether a template matches a search text (name, location, tags). */
export function matchesTemplateQuery(tpl: EventTemplate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    tpl.name,
    tpl.location?.name,
    tpl.location?.street,
    tpl.location?.city,
    ...tpl.properties.map((p) => p.property.name),
    ...tpl.features.map((f) => f.feature.name),
    ...tpl.targetGroups.map((g) => g.targetGroup.name),
  ];
  return haystack.some((h) => h?.toLowerCase().includes(q));
}

/** "HH:MM" start and end of a template, or null when it has no times (all-day events). */
export function templateTimes(
  tpl: Pick<EventTemplate, "timeBegin" | "timeEnd">,
): { from: string; to: string } | null {
  const from = shortTime(tpl.timeBegin);
  const to = shortTime(tpl.timeEnd);
  return from && to ? { from, to } : null;
}

/**
 * Consequence of deleting a template (design: Templates / TemplateEdit "Bereits aus dieser Vorlage
 * erzeugte Termine bleiben unverändert."), with the template's `eventCount` when the API sent it.
 */
export function templateDeleteConsequence(
  tpl: Pick<EventTemplate, "eventCount"> | undefined | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const count = tpl?.eventCount;
  if (count === undefined) return t("templates.delete.consequence");
  if (count === 0) return t("templates.delete.consequenceNone");
  return t("templates.delete.consequenceCount", { count });
}
