import type { QueryClient } from "@tanstack/react-query";
import { ApiError, apiGet } from "@/lib/api";

/**
 * The backend answers 422 `code: "unknown_reference"` ("<field>: unknown id …") when a request assigns a
 * property, feature, target group, location or template that does not exist (any more) in the calendar,
 * e.g. because it was deleted in another tab or by another member while the form was open.
 */
export function isUnknownIdError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 422 && e.code === "unknown_reference";
}

export type ReferenceKind = "properties" | "features" | "targetGroups" | "locations" | "templates";

const PATHS: Record<ReferenceKind, string> = {
  properties: "properties",
  features: "features",
  targetGroups: "target-groups",
  locations: "locations",
  templates: "templates",
};

/** Reloads reference lists of a calendar (also updating the cached lists) and returns their ids. */
async function freshReferenceIds(
  qc: QueryClient,
  calendarId: string,
  kinds: ReferenceKind[],
): Promise<Record<ReferenceKind, Set<string>>> {
  const result = {} as Record<ReferenceKind, Set<string>>;
  await Promise.all(
    kinds.map(async (kind) => {
      const list = await qc.fetchQuery({
        queryKey: [kind, calendarId],
        queryFn: () => apiGet<{ id: string }[]>(`/api/calendars/${calendarId}/${PATHS[kind]}`),
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
  calendarId: string,
  kinds: ReferenceKind[],
  body: B,
  send: (body: B) => Promise<R>,
  prune: (body: B, existing: Record<ReferenceKind, Set<string>>) => B,
): Promise<R> {
  try {
    return await send(body);
  } catch (e) {
    if (!isUnknownIdError(e)) throw e;
    const existing = await freshReferenceIds(qc, calendarId, kinds);
    return send(prune(body, existing));
  }
}

/** Keeps the ids that still exist. */
export function keepExisting(ids: string[], existing: Set<string>): string[] {
  return ids.filter((id) => existing.has(id));
}
