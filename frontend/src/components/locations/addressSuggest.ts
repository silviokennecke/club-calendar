import { apiFetch } from "@/lib/api";
import type { LocationForm } from "@/lib/settings";

export interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
}

export const SUGGEST_LIMIT = 6;

export type SuggestOutcome =
  { status: "ok"; suggestions: AddressSuggestion[] } | { status: "limit" | "error" };

/** Address-only geocoding through the backend; never throws (aborts count as "error"). */
export async function fetchAddressSuggestions(
  query: string,
  proximity: { lat: number; lng: number } | null,
  limit = SUGGEST_LIMIT,
  signal?: AbortSignal,
): Promise<SuggestOutcome> {
  try {
    const near = proximity ? `&lat=${proximity.lat}&lng=${proximity.lng}` : "";
    const res = await apiFetch(
      `/api/map/geocode/suggest?q=${encodeURIComponent(query)}${near}&limit=${limit}`,
      { signal },
    );
    if (res.status === 429) return { status: "limit" };
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as { suggestions: AddressSuggestion[] };
    return { status: "ok", suggestions: data.suggestions };
  } catch {
    return { status: "error" };
  }
}

/**
 * Auto-fill after leaving the street field: only while zip, city and country are all empty.
 * One hit fills them (and the position if still unset); several hits that are a complete list
 * (fewer than `limit`) fill the fields all hits share; a full page fills nothing.
 */
export function blurFillPatch(
  form: LocationForm,
  results: AddressSuggestion[],
  limit = SUGGEST_LIMIT,
): Partial<LocationForm> {
  if (form.zip.trim() || form.city.trim() || form.country.trim()) return {};
  if (results.length === 0 || results.length >= limit) return {};
  const patch: Partial<LocationForm> = {};
  for (const key of ["zip", "city", "country"] as const) {
    const first = results[0][key];
    if (first && results.every((r) => r[key] === first)) patch[key] = first;
  }
  if (results.length === 1 && form.latitude == null && form.longitude == null) {
    patch.latitude = results[0].lat;
    patch.longitude = results[0].lng;
  }
  return patch;
}
