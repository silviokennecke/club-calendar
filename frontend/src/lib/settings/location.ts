import type { Location } from "@/lib/types";
import { formatAddress } from "@/lib/types";

export interface LocationForm {
  name: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export const EMPTY_LOCATION_FORM: LocationForm = {
  name: "",
  street: "",
  zip: "",
  city: "",
  country: "",
  latitude: null,
  longitude: null,
};

export function locationToForm(loc: Location): LocationForm {
  return {
    name: loc.name ?? "",
    street: loc.street ?? "",
    zip: loc.zip ?? "",
    city: loc.city ?? "",
    country: loc.country ?? "",
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
  };
}

/** Body of POST/PATCH …/locations (empty strings become null). */
export function locationPayload(form: LocationForm) {
  const orNull = (s: string) => s.trim() || null;
  return {
    name: orNull(form.name),
    street: orNull(form.street),
    zip: orNull(form.zip),
    city: orNull(form.city),
    country: orNull(form.country),
    // A position needs both coordinates.
    latitude: form.latitude != null && form.longitude != null ? form.latitude : null,
    longitude: form.latitude != null && form.longitude != null ? form.longitude : null,
  };
}

/** A location needs at least a name or a street (design: SettingsPlaces). */
export function locationFormValid(form: LocationForm): boolean {
  return !!(form.name.trim() || form.street.trim());
}

export function sameLocationForm(a: LocationForm, b: LocationForm): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.street.trim() === b.street.trim() &&
    a.zip.trim() === b.zip.trim() &&
    a.city.trim() === b.city.trim() &&
    a.country.trim() === b.country.trim() &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude
  );
}

export type AddressField = "street" | "zip" | "city" | "country";

export interface GeocodedAddress {
  label?: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
}

/**
 * Fills only the address fields that are still empty from a geocoded address (position set on the
 * map). Returns the new form and the fields that were filled, for the info banner.
 */
export function fillEmptyAddress(
  form: LocationForm,
  geo: GeocodedAddress,
): { form: LocationForm; filled: AddressField[] } {
  const next = { ...form };
  const filled: AddressField[] = [];
  for (const key of ["street", "zip", "city", "country"] as const) {
    const value = geo[key];
    if (!form[key].trim() && value) {
      next[key] = value;
      filled.push(key);
    }
  }
  return { form: next, filled };
}

/** Display name of a location: name, else street, else null (the UI adds a fallback text). */
export function placeTitle(loc: Pick<Location, "name" | "street" | "zip" | "city" | "country">) {
  return loc.name || loc.street || formatAddress(loc) || null;
}

export function hasPosition(
  loc: Pick<Location, "latitude" | "longitude">,
): loc is { latitude: number; longitude: number } {
  return loc.latitude != null && loc.longitude != null;
}

/** Parses a coordinate typed by hand ("48,1371" or "48.1371"); null when empty or out of range. */
export function parseCoordinate(raw: string, limit: 90 | 180): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return Math.round(n * 1e6) / 1e6;
}
