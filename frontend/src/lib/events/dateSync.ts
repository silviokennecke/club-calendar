/**
 * Keeps start / end of the event form consistent (pure). `dateEnd` "" means a single-day event; the
 * form shows `dateEnd || date`, so the end date always appears filled.
 */
import { addDays, diffDays, isValidIso } from "@/lib/calendar";
import type { EventFormValues } from "./form";

type DateTimeValues = Pick<EventFormValues, "date" | "dateEnd" | "timeBegin" | "timeEnd">;

export function effectiveEndDate(v: Pick<EventFormValues, "date" | "dateEnd">): string {
  return v.dateEnd || v.date;
}

/** Moves the end with the start (same offset). */
export function applyStartDate<T extends DateTimeValues>(v: T, date: string): T {
  if (!isValidIso(date) || !isValidIso(v.date) || !isValidIso(v.dateEnd)) return { ...v, date };
  const offset = Math.max(0, diffDays(v.date, v.dateEnd));
  const end = addDays(date, offset);
  return { ...v, date, dateEnd: end === date ? "" : end };
}

/** An end before the start pulls the start back to the end date. */
export function applyEndDate<T extends DateTimeValues>(v: T, end: string): T {
  if (!isValidIso(end)) return { ...v, dateEnd: end };
  if (!isValidIso(v.date) || end <= v.date) {
    return { ...v, date: end, dateEnd: "" };
  }
  return { ...v, dateEnd: end };
}

/** On a single day the end time never stays before a changed start time. */
export function applyTimeBegin<T extends DateTimeValues>(v: T, timeBegin: string): T {
  const sameDay = !v.dateEnd || v.dateEnd === v.date;
  const timeEnd =
    sameDay && timeBegin && v.timeEnd && v.timeEnd < timeBegin ? timeBegin : v.timeEnd;
  return { ...v, timeBegin, timeEnd };
}
