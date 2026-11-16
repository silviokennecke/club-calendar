import type { EventFormValues } from "./form";
import { isMultiDayValues } from "./form";

export interface ResourceConflict {
  kind: "overlap" | "buffer";
  severity: "error" | "warning";
  resourceId: string;
  resourceName: string;
  calendarName: string;
  date: string;
  dateEnd: string | null;
  timeBegin: string;
  timeEnd: string;
  isAllDay: boolean;
  isDraft: boolean;
  eventId?: string;
  eventName?: string;
  forEventId?: string;
  forDate?: string;
}

export interface ConflictCheck {
  conflicts: ResourceConflict[];
  blocking: boolean;
}

export interface ConflictRequest {
  locationId: string;
  date: string;
  dateEnd: string | null;
  timeBegin?: string;
  timeEnd?: string;
  isAllDay: boolean;
  isDraft: boolean;
  timezone: string | null;
  eventId?: string;
}

/** Request body of the live check, or null while the form cannot be checked yet. */
export function conflictRequest(
  v: EventFormValues,
  timezone: string | null,
  eventId?: string,
): ConflictRequest | null {
  if (!v.locationId || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (!v.isAllDay && !(/^\d{2}:\d{2}$/.test(v.timeBegin) && /^\d{2}:\d{2}$/.test(v.timeEnd)))
    return null;
  if (isMultiDayValues(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v.dateEnd)) return null;
  return {
    locationId: v.locationId,
    date: v.date,
    dateEnd: isMultiDayValues(v) ? v.dateEnd : null,
    ...(v.isAllDay ? {} : { timeBegin: v.timeBegin, timeEnd: v.timeEnd }),
    isAllDay: v.isAllDay,
    isDraft: v.status === "draft",
    timezone,
    ...(eventId ? { eventId } : {}),
  };
}

/** Conflicts of a failed save (422 `resource_conflict`), else null. */
export function conflictsFromError(err: unknown): ResourceConflict[] | null {
  const e = err as { code?: string; conflicts?: unknown[] } | null;
  return e?.code === "resource_conflict" ? ((e.conflicts ?? []) as ResourceConflict[]) : null;
}
