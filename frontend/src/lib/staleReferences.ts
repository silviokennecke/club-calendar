import type { QueryClient } from "@tanstack/react-query";
import { ApiError, apiGet } from "@/lib/api";

/**
 * The backend answers 422 `code: "unknown_reference"` ("<field>: unknown id …") when a request assigns a
 * property, feature, target group, location or template that does not exist (any more) in the calendar or club,
 * e.g. because it was deleted in another tab or by another member while the form was open.
 */
export function isUnknownIdError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 422 && e.code === "unknown_reference";
}

export type ReferenceKind = "properties" | "features" | "targetGroups" | "locations" | "templates";

/** Locations and target groups belong to the club, the rest to the calendar. */
export interface ReferenceScope {
  clubId: string;
  calendarId: string;
}

/** Query key and API path of a reference list: `["locations", clubId]`, `["properties", calendarId]`. */
export function referenceList(kind: ReferenceKind, scope: ReferenceScope) {
  switch (kind) {
    case "targetGroups":
      return { key: [kind, scope.clubId], path: `/api/clubs/${scope.clubId}/target-groups` };
    case "locations":
      return { key: [kind, scope.clubId], path: `/api/clubs/${scope.clubId}/locations` };
    case "properties":
      return {
        key: [kind, scope.calendarId],
        path: `/api/calendars/${scope.calendarId}/properties`,
      };
    case "features":
      return { key: [kind, scope.calendarId], path: `/api/calendars/${scope.calendarId}/features` };
    case "templates":
      return {
        key: [kind, scope.calendarId],
        path: `/api/calendars/${scope.calendarId}/templates`,
      };
  }
}

/** Reloads reference lists of a calendar (also updating the cached lists) and returns their ids. */
async function freshReferenceIds(
  qc: QueryClient,
  scope: ReferenceScope,
  kinds: ReferenceKind[],
): Promise<Record<ReferenceKind, Set<string>>> {
  const result = {} as Record<ReferenceKind, Set<string>>;
  await Promise.all(
    kinds.map(async (kind) => {
      const { key, path } = referenceList(kind, scope);
      const list = await qc.fetchQuery({
        queryKey: key,
        queryFn: () => apiGet<{ id: string }[]>(path),
        staleTime: 0,
      });
      result[kind] = new Set(list.map((x) => x.id));
    }),
  );
  return result;
}

/**
 * Saves with `send`; if the backend rejects an assignment that no longer exists, reloads the lists,
 * drops what is gone (`prune`) and saves once more. Before the backend checked assignments, such ids
 * were ignored silently; the user cannot remove them in the form because deleted entries are not shown.
 */
export async function saveDroppingDeletedReferences<B, R>(
  qc: QueryClient,
  scope: ReferenceScope,
  kinds: ReferenceKind[],
  body: B,
  send: (body: B) => Promise<R>,
  prune: (body: B, existing: Record<ReferenceKind, Set<string>>) => B,
): Promise<R> {
  try {
    return await send(body);
  } catch (e) {
    if (!isUnknownIdError(e)) throw e;
    const existing = await freshReferenceIds(qc, scope, kinds);
    return send(prune(body, existing));
  }
}

/** Keeps the ids that still exist. */
export function keepExisting(ids: string[], existing: Set<string>): string[] {
  return ids.filter((id) => existing.has(id));
}
