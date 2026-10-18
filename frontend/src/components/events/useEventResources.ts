import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type { Feature, Location, Property, TargetGroup } from "@/lib/types";

/**
 * Reference data for the event form, plus inline creation. Properties and features belong to the
 * calendar (`["properties", calendarId]`), target groups and locations to the club
 * (`["locations", clubId]`).
 */
export function useEventResources(clubId: string, calendarId: string) {
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
    queryKey: ["targetGroups", clubId],
    queryFn: () => apiGet<TargetGroup[]>(`/api/clubs/${clubId}/target-groups`),
  });
  const locations = useQuery({
    queryKey: ["locations", clubId],
    queryFn: () => apiGet<Location[]>(`/api/clubs/${clubId}/locations`),
  });

  /** `scope` is the owner of the list: the calendar or the club. */
  async function create<T extends { id: string }>(
    owner: "calendars" | "clubs",
    path: string,
    key: string,
    body: object,
  ) {
    const ownerId = owner === "clubs" ? clubId : calendarId;
    const created = await apiPost<T>(`/api/${owner}/${ownerId}/${path}`, body);
    await qc.invalidateQueries({ queryKey: [key, ownerId] });
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
    createProperty: (name: string) =>
      create<Property>("calendars", "properties", "properties", { name }),
    createFeature: (name: string) => create<Feature>("calendars", "features", "features", { name }),
    createTargetGroup: (name: string) =>
      create<TargetGroup>("clubs", "target-groups", "targetGroups", { name }),
    createLocation: (name: string) => create<Location>("clubs", "locations", "locations", { name }),
    async moveLocation(locationId: string, latitude: number, longitude: number) {
      await apiPatch(`/api/clubs/${clubId}/locations/${locationId}`, {
        latitude,
        longitude,
      });
      await qc.invalidateQueries({ queryKey: ["locations", clubId] });
    },
  };
}
