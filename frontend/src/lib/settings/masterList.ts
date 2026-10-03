import type { CalendarEvent, EventTemplate } from "@/lib/types";

/** The three reference lists managed by the same screen (design: SettingsMasterList). */
export type MasterKind = "properties" | "features" | "audiences";

export interface MasterItem {
  id: string;
  name: string;
  icon?: string | null;
}

export interface MasterKindConfig {
  /** API collection below /api/calendars/:id/. */
  path: string;
  /** Query key base, shared with the event and template forms so their lists refresh, too. */
  queryKey: string;
  /** Items can carry a club-chosen emoji. */
  hasSymbol: boolean;
  /** Items are shown as audience tag (tone by position). */
  hasTone: boolean;
}

export const MASTER_KINDS: Record<MasterKind, MasterKindConfig> = {
  properties: { path: "properties", queryKey: "properties", hasSymbol: true, hasTone: false },
  features: { path: "features", queryKey: "features", hasSymbol: false, hasTone: false },
  audiences: { path: "target-groups", queryKey: "targetGroups", hasSymbol: false, hasTone: true },
};

export type NameProblem = "empty" | "duplicate";

/** Name check of the add and rename forms: required and unique (case-insensitive) in the list. */
export function validateName(
  name: string,
  items: ReadonlyArray<Pick<MasterItem, "id" | "name">>,
  exceptId?: string,
): NameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  const lower = trimmed.toLowerCase();
  if (items.some((i) => i.id !== exceptId && i.name.trim().toLowerCase() === lower)) {
    return "duplicate";
  }
  return null;
}

export interface Usage {
  events: number;
  templates: number;
}

type Assigned = Pick<CalendarEvent, "properties" | "features" | "targetGroups">;

function uses(kind: MasterKind, id: string, item: Assigned): boolean {
  switch (kind) {
    case "properties":
      return item.properties.some((p) => p.property.id === id);
    case "features":
      return item.features.some((f) => f.feature.id === id);
    case "audiences":
      return item.targetGroups.some((g) => g.targetGroup.id === id);
  }
}

/** How many events and templates reference an item (what deleting it detaches it from). */
export function countUsage(
  kind: MasterKind,
  id: string,
  events: ReadonlyArray<Assigned>,
  templates: ReadonlyArray<Pick<EventTemplate, "properties" | "features" | "targetGroups">>,
): Usage {
  return {
    events: events.filter((e) => uses(kind, id, e)).length,
    templates: templates.filter((tpl) => uses(kind, id, tpl)).length,
  };
}

/** How many events and templates take place at a location. */
export function countLocationUsage(
  id: string,
  events: ReadonlyArray<{ locationId: string | null }>,
  templates: ReadonlyArray<{ locationId: string | null }>,
): Usage {
  return {
    events: events.filter((e) => e.locationId === id).length,
    templates: templates.filter((tpl) => tpl.locationId === id).length,
  };
}
