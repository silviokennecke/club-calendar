import type { Resource, ResourceVisibility } from "@/lib/types";

export interface ResourceForm {
  locationId: string;
  name: string;
  visibility: ResourceVisibility;
  allowDoubleBooking: boolean;
  /** Text of the number field (full hours). */
  bufferHours: string;
}

export const EMPTY_RESOURCE_FORM: ResourceForm = {
  locationId: "",
  name: "",
  visibility: "staff",
  allowDoubleBooking: false,
  bufferHours: "0",
};

export type ResourceProblem = "nameRequired" | "locationRequired" | "bufferRange";

export function minutesToHours(minutes: number): number {
  return Math.round(minutes / 60);
}

/** Whole hours 0..24 as minutes, or null when the text is not such a number. */
export function hoursToMinutes(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const hours = Number(s);
  return hours >= 0 && hours <= 24 ? hours * 60 : null;
}

export function resourceToForm(r: Resource): ResourceForm {
  return {
    locationId: r.locationId,
    name: r.name,
    visibility: r.visibility,
    allowDoubleBooking: r.allowDoubleBooking,
    bufferHours: String(minutesToHours(r.bufferMinutes)),
  };
}

export function validateResourceForm(form: ResourceForm, creating: boolean): ResourceProblem[] {
  const problems: ResourceProblem[] = [];
  if (creating && !form.locationId) problems.push("locationRequired");
  if (!form.name.trim()) problems.push("nameRequired");
  if (hoursToMinutes(form.bufferHours) === null) problems.push("bufferRange");
  return problems;
}

export function sameResourceForm(a: ResourceForm, b: ResourceForm): boolean {
  return (
    a.locationId === b.locationId &&
    a.name.trim() === b.name.trim() &&
    a.visibility === b.visibility &&
    a.allowDoubleBooking === b.allowDoubleBooking &&
    a.bufferHours.trim() === b.bufferHours.trim()
  );
}
