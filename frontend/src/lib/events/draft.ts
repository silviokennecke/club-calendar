/**
 * Local draft of the event form (FRM-19): form field values only, in localStorage so a reload or a
 * lost session does not lose the input. Every storage access is guarded (private mode, blocked).
 */
import { isValidIso } from "@/lib/calendar";
import type { EventFormValues } from "./form";

export const DRAFT_PREFIX = "cc:draft:v1:";
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function draftKey(userId: string, calendarId: string, eventId: string | null): string {
  return `${DRAFT_PREFIX}${userId}:${calendarId}:${eventId ?? "new"}`;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isTime = (v: unknown) => isStr(v) && /^\d{2}:\d{2}$/.test(v);
const isDay = (v: unknown) => isStr(v) && (v === "" || isValidIso(v));

function parseValues(v: unknown): EventFormValues | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    !isStr(o.name) ||
    !isDay(o.date) ||
    !isDay(o.dateEnd) ||
    typeof o.isAllDay !== "boolean" ||
    !isTime(o.timeBegin) ||
    !isTime(o.timeEnd) ||
    (o.status !== "draft" && o.status !== "published") ||
    !isStr(o.locationId) ||
    !isIds(o.propertyIds) ||
    !isIds(o.featureIds) ||
    !isIds(o.targetGroupIds) ||
    !(o.eventTemplateId === null || isStr(o.eventTemplateId)) ||
    !isStr(o.note)
  )
    return null;
  return {
    name: o.name,
    date: o.date as string,
    dateEnd: o.dateEnd as string,
    isAllDay: o.isAllDay,
    timeBegin: o.timeBegin as string,
    timeEnd: o.timeEnd as string,
    status: o.status,
    locationId: o.locationId,
    propertyIds: o.propertyIds,
    featureIds: o.featureIds,
    targetGroupIds: o.targetGroupIds,
    eventTemplateId: o.eventTemplateId,
    note: o.note,
  };
}

export function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export function saveDraft(key: string, values: EventFormValues, now = Date.now()): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: now, values }));
  } catch {
    /* storage unavailable or full: the form works without a draft */
  }
}

/** The stored draft, or null; expired or malformed drafts are removed. */
export function loadDraft(key: string, now = Date.now()): EventFormValues | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const data = JSON.parse(raw) as { savedAt?: unknown; values?: unknown } | null;
    const values = parseValues(data?.values);
    if (
      typeof data?.savedAt !== "number" ||
      !values ||
      now - data.savedAt > DRAFT_MAX_AGE_MS ||
      data.savedAt > now + 60_000
    ) {
      removeDraft(key);
      return null;
    }
    return values;
  } catch {
    removeDraft(key);
    return null;
  }
}

/** Removes the drafts of all users (`keepUserId`: of all users but this one). */
export function clearDrafts(keepUserId?: string): void {
  try {
    const storage = window.localStorage;
    const keep = keepUserId ? `${DRAFT_PREFIX}${keepUserId}:` : null;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(DRAFT_PREFIX) && !(keep && key.startsWith(keep))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Drops ids that no longer exist (deleted places, properties, ...). */
export function dropUnknownReferences(
  values: EventFormValues,
  known: {
    locations: string[];
    properties: string[];
    features: string[];
    targetGroups: string[];
  },
): EventFormValues {
  return {
    ...values,
    locationId: known.locations.includes(values.locationId) ? values.locationId : "",
    propertyIds: values.propertyIds.filter((id) => known.properties.includes(id)),
    featureIds: values.featureIds.filter((id) => known.features.includes(id)),
    targetGroupIds: values.targetGroupIds.filter((id) => known.targetGroups.includes(id)),
  };
}
