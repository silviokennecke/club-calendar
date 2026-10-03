import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type { Feature, Location, Property, TargetGroup } from "@/lib/types";

/** Reference data of a calendar for the event form, plus inline creation. */
export function useEventResources(calendarId: string) {
  const qc = useQueryClient();
  const properties = useQuery({
    queryKey: ["properties", calendarId],
    queryFn: () => apiGet<Property[]>(`/api/calendars/${calendarId}/properties`),
  });
  const features = useQuery({
    queryKey: ["features", calendarId],
    queryFn: () => apiGet<Feature[]>(`/api/calendars/${calendarId}/features`),
  });
  const targetGroups = useQuery({
    queryKey: ["targetGroups", calendarId],
    queryFn: () => apiGet<TargetGroup[]>(`/api/calendars/${calendarId}/target-groups`),
  });
  const locations = useQuery({
    queryKey: ["locations", calendarId],
    queryFn: () => apiGet<Location[]>(`/api/calendars/${calendarId}/locations`),
  });

  async function create<T extends { id: string }>(path: string, key: string, body: object) {
    const created = await apiPost<T>(`/api/calendars/${calendarId}/${path}`, body);
    await qc.invalidateQueries({ queryKey: [key, calendarId] });
    return created;
  }

  const queries = [properties, features, targetGroups, locations];

  return {
    /** Some list is still loading for the first time. */
    loading: queries.some((q) => q.isPending && !q.isError),
    /** Some list could not be loaded. */
    failed: queries.some((q) => q.isError && !q.data),
    reload: () => queries.forEach((q) => void q.refetch()),
    properties: properties.data ?? [],
    features: features.data ?? [],
    targetGroups: targetGroups.data ?? [],
    locations: locations.data ?? [],
    createProperty: (name: string) => create<Property>("properties", "properties", { name }),
    createFeature: (name: string) => create<Feature>("features", "features", { name }),
    createTargetGroup: (name: string) =>
      create<TargetGroup>("target-groups", "targetGroups", { name }),
    createLocation: (name: string) => create<Location>("locations", "locations", { name }),
    async moveLocation(locationId: string, latitude: number, longitude: number) {
      await apiPatch(`/api/calendars/${calendarId}/locations/${locationId}`, {
        latitude,
        longitude,
      });
      await qc.invalidateQueries({ queryKey: ["locations", calendarId] });
    },
  };
}
