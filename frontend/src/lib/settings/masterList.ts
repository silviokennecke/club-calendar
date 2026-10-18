import type { LocationUsage, ReferenceUsage } from "@/lib/types";

/** The three reference lists managed by the same screen (design: SettingsMasterList). */
export type MasterKind = "properties" | "features" | "audiences";

export interface MasterItem {
  id: string;
  name: string;
  icon?: string | null;
  /** From the list endpoint: events / templates (/ feeds) the item is assigned to. */
  usage?: ReferenceUsage;
}

export interface MasterKindConfig {
  /** API collection below the owner. */
  path: string;
  /** Owner of the list: properties / features belong to the calendar, audiences to the club. */
  owner: "calendars" | "clubs";
  /** Query key base (`[queryKey, ownerId]`), shared with the event and template forms so their lists refresh, too. */
  queryKey: string;
  /** Items can carry a club-chosen emoji. */
  hasSymbol: boolean;
  /** Items are shown as audience tag (tone by position). */
  hasTone: boolean;
}

export const MASTER_KINDS: Record<MasterKind, MasterKindConfig> = {
  properties: {
    owner: "calendars",
    path: "properties",
    queryKey: "properties",
    hasSymbol: true,
    hasTone: false,
  },
  features: {
    owner: "calendars",
    path: "features",
    queryKey: "features",
    hasSymbol: false,
    hasTone: false,
  },
  audiences: {
    owner: "clubs",
    path: "target-groups",
    queryKey: "targetGroups",
    hasSymbol: false,
    hasTone: true,
  },
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

/** Translator of one master kind (`settings.master.<kind>.…`). */
export type KindTranslate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Consequence of deleting a property / feature / audience (design: Dialogs.dc.html): "Bei 2 Terminen
 * (A, B) wird die Zuordnung entfernt. …" with the names the backend sends for up to 3 events, the
 * templates (not in the design) and, for audiences with feeds, the feed sentence. Without `usage`
 * (list not loaded) a general wording.
 */
export function masterConsequence(
  kind: MasterKind,
  item: Pick<MasterItem, "name" | "usage">,
  tk: KindTranslate,
): string {
  const u = item.usage;
  const parts: string[] = [];
  if (!u) {
    parts.push(tk("consequence.unknown", { name: item.name }));
    if (kind === "audiences") parts.push(tk("consequence.feeds"));
    return parts.join(" ");
  }
  if (u.events > 0)
    parts.push(
      u.eventNames.length > 0
        ? tk("consequence.eventsNamed", { count: u.events, names: u.eventNames.join(", ") })
        : tk("consequence.events", { count: u.events }),
    );
  if (u.templates > 0) parts.push(tk("consequence.templates", { count: u.templates }));
  if (parts.length === 0) parts.push(tk("consequence.none", { name: item.name }));
  if (kind === "audiences" && (u.feeds ?? 0) > 0) parts.push(tk("consequence.feeds"));
  return parts.join(" ");
}

/** Template named in the place delete consequence when exactly one template uses the place. */
export function locationTemplateName(usage: LocationUsage | undefined): string | null {
  return usage && usage.templates === 1 && usage.templateNames.length === 1
    ? usage.templateNames[0]
    : null;
}
