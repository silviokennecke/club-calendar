/**
 * Event form: values, validation and the request body (pure, no React).
 * Dates are ISO strings ("YYYY-MM-DD"), times "HH:MM" as the native inputs deliver them.
 */
import { isValidIso, type IsoDate } from "@/lib/calendar";
import type { CalendarEvent, EventTemplate } from "@/lib/types";

export type EventStatus = "draft" | "published";

/** Longest note the backend accepts (422 `validation_failed` on `note` beyond that). */
export const NOTE_MAX = 2000;

export interface EventFormValues {
  name: string;
  date: string;
  /** Empty for single-day events. */
  dateEnd: string;
  isAllDay: boolean;
  timeBegin: string;
  timeEnd: string;
  status: EventStatus;
  /** Empty = no location. */
  locationId: string;
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
  /** Template the event was created from (kept when editing). */
  eventTemplateId: string | null;
  /** Plain-text note, newlines kept; empty = no note. */
  note: string;
}

export const DEFAULT_TIME_BEGIN = "19:00";
export const DEFAULT_TIME_END = "21:00";

export function emptyEventValues(date?: string | null): EventFormValues {
  return {
    name: "",
    date: date && isValidIso(date) ? date : "",
    dateEnd: "",
    isAllDay: false,
    timeBegin: DEFAULT_TIME_BEGIN,
    timeEnd: DEFAULT_TIME_END,
    status: "draft",
    locationId: "",
    propertyIds: [],
    featureIds: [],
    targetGroupIds: [],
    eventTemplateId: null,
    note: "",
  };
}

function shortTime(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** Form values of an existing event. */
export function valuesFromEvent(ev: CalendarEvent): EventFormValues {
  const date = ev.date.slice(0, 10);
  const end = ev.dateEnd ? ev.dateEnd.slice(0, 10) : "";
  return {
    name: ev.name,
    date,
    dateEnd: end && end !== date ? end : "",
    isAllDay: !!ev.isAllDay,
    timeBegin: shortTime(ev.timeBegin) || DEFAULT_TIME_BEGIN,
    timeEnd: shortTime(ev.timeEnd) || DEFAULT_TIME_END,
    status: ev.isDraft ? "draft" : "published",
    locationId: ev.locationId ?? ev.location?.id ?? "",
    propertyIds: ev.properties.map((p) => p.property.id),
    featureIds: ev.features.map((f) => f.feature.id),
    targetGroupIds: ev.targetGroups.map((g) => g.targetGroup.id),
    eventTemplateId: ev.eventTemplateId ?? null,
    note: ev.note ?? "",
  };
}

/**
 * A new event pre-filled from a template: name, times, location and all assignments. A template
 * without times makes the event all-day (same rule as `POST …/events/from-template`).
 */
export function valuesFromTemplate(tpl: EventTemplate, date?: string | null): EventFormValues {
  return {
    ...emptyEventValues(date),
    name: tpl.name,
    isAllDay: !shortTime(tpl.timeBegin) || !shortTime(tpl.timeEnd),
    timeBegin: shortTime(tpl.timeBegin) || DEFAULT_TIME_BEGIN,
    timeEnd: shortTime(tpl.timeEnd) || DEFAULT_TIME_END,
    locationId: tpl.locationId ?? tpl.location?.id ?? "",
    propertyIds: tpl.properties.map((p) => p.property.id),
    featureIds: tpl.features.map((f) => f.feature.id),
    targetGroupIds: tpl.targetGroups.map((g) => g.targetGroup.id),
    eventTemplateId: tpl.id,
    note: tpl.note ?? "",
  };
}

/**
 * Applies a template to the values of an event being created: everything the template has a value
 * for overwrites the form (name, both times, location, assignments, note, template id); the dates
 * and the status are never touched. Without both times, all-day and times stay as they are.
 */
export function applyTemplateToValues(v: EventFormValues, tpl: EventTemplate): EventFormValues {
  const begin = shortTime(tpl.timeBegin);
  const end = shortTime(tpl.timeEnd);
  const locationId = tpl.locationId ?? tpl.location?.id ?? "";
  const propertyIds = tpl.properties.map((p) => p.property.id);
  const featureIds = tpl.features.map((f) => f.feature.id);
  const targetGroupIds = tpl.targetGroups.map((g) => g.targetGroup.id);
  return {
    ...v,
    name: tpl.name,
    ...(begin && end ? { isAllDay: false, timeBegin: begin, timeEnd: end } : {}),
    locationId: locationId || v.locationId,
    propertyIds: propertyIds.length > 0 ? propertyIds : v.propertyIds,
    featureIds: featureIds.length > 0 ? featureIds : v.featureIds,
    targetGroupIds: targetGroupIds.length > 0 ? targetGroupIds : v.targetGroupIds,
    note: tpl.note ? tpl.note : v.note,
    eventTemplateId: tpl.id,
  };
}

export type EventField = "name" | "date" | "dateEnd" | "timeBegin" | "timeEnd" | "note";

export type EventErrorCode =
  | "nameRequired"
  | "dateRequired"
  | "dateInvalid"
  | "dateEndInvalid"
  | "dateEndBeforeStart"
  | "timeBeginRequired"
  | "timeEndRequired"
  | "timeEndBeforeStart"
  | "noteTooLong";

export interface EventFormError {
  field: EventField;
  code: EventErrorCode;
}

/** All problems in display order (top to bottom of the form). */
export function validateEvent(v: EventFormValues): EventFormError[] {
  const errors: EventFormError[] = [];
  if (!v.name.trim()) errors.push({ field: "name", code: "nameRequired" });
  if (!v.date) errors.push({ field: "date", code: "dateRequired" });
  else if (!isValidIso(v.date)) errors.push({ field: "date", code: "dateInvalid" });
  if (v.dateEnd) {
    if (!isValidIso(v.dateEnd)) errors.push({ field: "dateEnd", code: "dateEndInvalid" });
    else if (isValidIso(v.date) && v.dateEnd < v.date)
      errors.push({ field: "dateEnd", code: "dateEndBeforeStart" });
  }
  if (!v.isAllDay) {
    if (!v.timeBegin) errors.push({ field: "timeBegin", code: "timeBeginRequired" });
    if (!v.timeEnd) errors.push({ field: "timeEnd", code: "timeEndRequired" });
    // On one day the end must not be before the start; across days any time is fine.
    if (v.timeBegin && v.timeEnd && !isMultiDayValues(v) && v.timeEnd < v.timeBegin)
      errors.push({ field: "timeEnd", code: "timeEndBeforeStart" });
  }
  if (v.note.length > NOTE_MAX) errors.push({ field: "note", code: "noteTooLong" });
  return errors;
}

/** True when an end date after the start date is set. */
export function isMultiDayValues(v: Pick<EventFormValues, "date" | "dateEnd">): boolean {
  return !!v.dateEnd && isValidIso(v.dateEnd) && isValidIso(v.date) && v.dateEnd > v.date;
}

export interface EventPayload {
  name: string;
  date: IsoDate;
  dateEnd: IsoDate | null;
  isAllDay: boolean;
  timeBegin: string;
  timeEnd: string;
  isDraft: boolean;
  locationId: string | null;
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
  /** "" = no note. */
  note: string;
  eventTemplateId?: string;
}

/**
 * Request body for POST / PATCH. An end date equal to the start is sent as null (single day);
 * all-day events keep their times (the backend requires them) with a whole-day fallback.
 */
export function toEventPayload(v: EventFormValues): EventPayload {
  const payload: EventPayload = {
    name: v.name.trim(),
    date: v.date,
    dateEnd: isMultiDayValues(v) ? v.dateEnd : null,
    isAllDay: v.isAllDay,
    timeBegin: v.timeBegin || (v.isAllDay ? "00:00" : DEFAULT_TIME_BEGIN),
    timeEnd: v.timeEnd || (v.isAllDay ? "23:59" : DEFAULT_TIME_END),
    isDraft: v.status === "draft",
    locationId: v.locationId || null,
    propertyIds: v.propertyIds,
    featureIds: v.featureIds,
    targetGroupIds: v.targetGroupIds,
    note: v.note,
  };
  if (v.eventTemplateId) payload.eventTemplateId = v.eventTemplateId;
  return payload;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Whether the user changed anything compared to the initial values. */
export function isFormDirty(initial: EventFormValues, current: EventFormValues): boolean {
  return (
    initial.name !== current.name ||
    initial.date !== current.date ||
    initial.dateEnd !== current.dateEnd ||
    initial.isAllDay !== current.isAllDay ||
    (!current.isAllDay &&
      (initial.timeBegin !== current.timeBegin || initial.timeEnd !== current.timeEnd)) ||
    initial.status !== current.status ||
    initial.note !== current.note ||
    initial.locationId !== current.locationId ||
    !sameSet(initial.propertyIds, current.propertyIds) ||
    !sameSet(initial.featureIds, current.featureIds) ||
    !sameSet(initial.targetGroupIds, current.targetGroupIds)
  );
}
