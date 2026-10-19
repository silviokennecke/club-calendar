/**
 * Review step of the ICS import (pure, no React): items with their editable state, groups by
 * name, location matching, bulk edits, duplicate hints and the request bodies.
 */
import type { IsoDate } from "@/lib/calendar";
import {
  formatAddress,
  type ImportPreviewEntry,
  type ImportWarning,
  type Location,
} from "@/lib/types";
import { locationName, type EventStatus } from "@/lib/events";
import type { ParsedIcsEvent } from "./ics";

/** Where an imported event happens. */
export type PlaceRef =
  { kind: "none" } | { kind: "existing"; id: string } | { kind: "new"; name: string };

export type IdField = "propertyIds" | "featureIds" | "targetGroupIds";

export interface ImportItem {
  /** Unique within the import (file order). */
  id: string;
  /** Key of the group the event was sorted into when the file was read. */
  groupKey: string;
  /** UID of the file ("" = none), sent as `externalUid`. */
  uid: string;
  name: string;
  date: IsoDate;
  dateEnd: IsoDate | "";
  isAllDay: boolean;
  timeBegin: string;
  timeEnd: string;
  timezone: string | null;
  /** Original LOCATION text of the file. */
  locationText: string;
  /** Plain-text note from DESCRIPTION ("" = none). */
  note: string;
  /** Set when the user picked a place; otherwise the place follows from `locationText`. */
  placeOverride: PlaceRef | null;
  /** Instance of an expanded recurrence of the file (imported as a single event). */
  recurring: boolean;
  /** Same key for all instances of one recurrence (UID), null otherwise. */
  recurrenceKey: string | null;
  /** The file's RRULE is not supported: only this first event is imported. */
  recurrenceUnsupported: boolean;
  status: EventStatus;
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
  selected: boolean;
}

/** Key of the group that collects all events with a name of their own. */
export const OTHERS_GROUP = "__others__";

export interface ImportGroup {
  key: string;
  /** Null for the "other events" group (its name is translated by the UI). */
  name: string | null;
  items: ImportItem[];
  /** Show the name column (other events, or names that differ after editing). */
  showName: boolean;
}

function compareItems(a: ImportItem, b: ImportItem): number {
  return a.date.localeCompare(b.date) || a.timeBegin.localeCompare(b.timeBegin);
}

/** Editable items from the parsed events: sorted by date, all selected, status draft. */
export function buildItems(parsed: ParsedIcsEvent[]): ImportItem[] {
  const counts = new Map<string, number>();
  for (const ev of parsed) counts.set(ev.name, (counts.get(ev.name) ?? 0) + 1);
  return parsed
    .map<ImportItem>((ev, i) => ({
      id: `i${i + 1}`,
      groupKey: (counts.get(ev.name) ?? 0) >= 2 ? ev.name : OTHERS_GROUP,
      uid: ev.uid,
      name: ev.name,
      date: ev.date,
      dateEnd: ev.dateEnd,
      isAllDay: ev.isAllDay,
      timeBegin: ev.timeBegin,
      timeEnd: ev.timeEnd,
      timezone: ev.timezone,
      locationText: ev.locationText,
      note: ev.note,
      placeOverride: null,
      recurring: ev.recurring,
      recurrenceKey: ev.recurrenceKey,
      recurrenceUnsupported: ev.recurrenceUnsupported,
      status: "draft",
      propertyIds: [],
      featureIds: [],
      targetGroupIds: [],
      selected: true,
    }))
    .sort(compareItems);
}

/** Groups in display order: events sharing a name by first date, the rest last. */
export function groupItems(items: ImportItem[]): ImportGroup[] {
  const map = new Map<string, ImportItem[]>();
  for (const item of items) {
    const list = map.get(item.groupKey);
    if (list) list.push(item);
    else map.set(item.groupKey, [item]);
  }
  const groups: ImportGroup[] = [...map.entries()].map(([key, list]) => {
    const sameName = list.every((i) => i.name === list[0].name);
    const others = key === OTHERS_GROUP;
    return {
      key,
      name: others ? null : sameName ? list[0].name : key,
      items: list,
      showName: others || !sameName,
    };
  });
  return groups.sort((a, b) => Number(a.key === OTHERS_GROUP) - Number(b.key === OTHERS_GROUP));
}

/** Instances per recurrence of the given items ("Wiederholung (n Termine)"), in order of appearance. */
export function recurrenceCounts(items: Pick<ImportItem, "recurrenceKey">[]): number[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.recurrenceKey !== null)
      counts.set(item.recurrenceKey, (counts.get(item.recurrenceKey) ?? 0) + 1);
  }
  return [...counts.values()];
}

export type SelectionState = "all" | "some" | "none";

export function selectionState(items: Pick<ImportItem, "selected">[]): SelectionState {
  const n = items.filter((i) => i.selected).length;
  return n === 0 ? "none" : n === items.length ? "all" : "some";
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The existing location a free text of the file refers to (name, street or address), if any. */
export function matchLocation(text: string, locations: Location[]): Location | undefined {
  const wanted = norm(text);
  if (!wanted) return undefined;
  return locations.find((loc) => {
    const name = norm(loc.name ?? "");
    const address = norm(formatAddress(loc));
    const candidates = [
      name,
      norm(loc.street ?? ""),
      address,
      name && address ? `${name}, ${address}` : "",
    ];
    return candidates.some((c) => c && c === wanted) || (!!name && wanted.startsWith(`${name},`));
  });
}

/** The place of an item: the user's choice, else the match of the file's text, else a new one. */
export function resolvePlace(item: ImportItem, locations: Location[]): PlaceRef {
  const override = item.placeOverride;
  if (override) {
    if (override.kind === "existing" && !locations.some((l) => l.id === override.id)) {
      return { kind: "none" };
    }
    return override;
  }
  if (!item.locationText) return { kind: "none" };
  const match = matchLocation(item.locationText, locations);
  return match ? { kind: "existing", id: match.id } : { kind: "new", name: item.locationText };
}

function placeKey(place: PlaceRef): string {
  return place.kind === "none"
    ? ""
    : place.kind === "existing"
      ? `id:${place.id}`
      : `new:${norm(place.name)}`;
}

/** `<select>` value of a place ("" = none, "id:…" existing, "new:…" from the file). */
export function placeToValue(place: PlaceRef): string {
  return place.kind === "none"
    ? ""
    : place.kind === "existing"
      ? `id:${place.id}`
      : `new:${place.name}`;
}

export function placeFromValue(value: string): PlaceRef {
  if (value.startsWith("id:")) return { kind: "existing", id: value.slice(3) };
  if (value.startsWith("new:")) return { kind: "new", name: value.slice(4) };
  return { kind: "none" };
}

/** Display name of a place. */
export function placeLabel(place: PlaceRef, locations: Location[]): string {
  if (place.kind === "new") return place.name;
  if (place.kind === "existing") {
    const loc = locations.find((l) => l.id === place.id);
    return loc ? locationName(loc) : "";
  }
  return "";
}

/** One place for the whole group, none, or "mixed" when the events differ. */
export function groupPlace(items: ImportItem[], locations: Location[]): PlaceRef | "mixed" {
  const places = items.map((i) => resolvePlace(i, locations));
  const first = places[0] ?? { kind: "none" as const };
  return places.every((p) => placeKey(p) === placeKey(first)) ? first : "mixed";
}

/** Distinct new places named in the file for the select ("neu aus der Datei"). */
export function newPlaceNames(items: ImportItem[], locations: Location[]): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const place = resolvePlace(item, locations);
    if (place.kind === "new" && !seen.has(norm(place.name))) seen.set(norm(place.name), place.name);
  }
  return [...seen.values()];
}

export function patchItems(
  items: ImportItem[],
  match: (item: ImportItem) => boolean,
  patch: Partial<ImportItem>,
): ImportItem[] {
  return items.map((item) => (match(item) ? { ...item, ...patch } : item));
}

/** Ids every one of the items has (what a bulk panel shows as selected). */
export function commonIds(items: ImportItem[], field: IdField): string[] {
  if (items.length === 0) return [];
  return items[0][field].filter((id) => items.every((i) => i[field].includes(id)));
}

/** Status all items share, or null when mixed or empty. */
export function commonStatus(items: ImportItem[]): EventStatus | null {
  if (items.length === 0) return null;
  return items.every((i) => i.status === items[0].status) ? items[0].status : null;
}

/** Sets the ids to `next` for all matching items by adding / removing only what changed. */
export function applyIds(
  items: ImportItem[],
  match: (item: ImportItem) => boolean,
  field: IdField,
  previous: string[],
  next: string[],
): ImportItem[] {
  const added = next.filter((id) => !previous.includes(id));
  const removed = previous.filter((id) => !next.includes(id));
  if (added.length === 0 && removed.length === 0) return items;
  return items.map((item) => {
    if (!match(item)) return item;
    const kept = item[field].filter((id) => !removed.includes(id));
    return { ...item, [field]: [...kept, ...added.filter((id) => !kept.includes(id))] };
  });
}

const LEADING_ICONS =
  /^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]|\u200D|\uFE0F|\s)+/u;

/**
 * The name without property icons in front of it: the ICS export writes "🎯 Training" (one icon
 * per property), so a re-imported file must still match the stored "Training". A name that
 * consists of icons only stays as it is.
 */
export function withoutLeadingIcons(name: string): string {
  const stripped = name.replace(LEADING_ICONS, "");
  return stripped.trim() ? stripped : name;
}

/**
 * Items that look like events the calendar already has (same name and day). Only the fallback when
 * the backend's preview (`POST …/events/import/preview`, which also compares the ICS UID) fails.
 */
export function findDuplicates(
  items: ImportItem[],
  existing: { name: string; date: string }[],
): Set<string> {
  const key = (name: string, date: string) =>
    `${norm(withoutLeadingIcons(name))}|${date.slice(0, 10)}`;
  const known = new Set(existing.map((e) => key(e.name, e.date)));
  return new Set(items.filter((i) => known.has(key(i.name, i.date))).map((i) => i.id));
}

export interface ImportSummary {
  selected: number;
  total: number;
  unselected: number;
  drafts: number;
  published: number;
  /** New places that will be created (distinct, in order of appearance). */
  newPlaces: string[];
}

export function summarizeImport(items: ImportItem[], locations: Location[]): ImportSummary {
  const selected = items.filter((i) => i.selected);
  return {
    selected: selected.length,
    total: items.length,
    unselected: items.length - selected.length,
    drafts: selected.filter((i) => i.status === "draft").length,
    published: selected.filter((i) => i.status === "published").length,
    newPlaces: newPlaceNames(selected, locations),
  };
}

export interface ImportEventPayload {
  name: string;
  date: IsoDate;
  dateEnd: IsoDate | null;
  isAllDay: boolean;
  timeBegin: string;
  timeEnd: string;
  timezone: string | null;
  isDraft: boolean;
  /** An existing place of the calendar … */
  locationId: string | null;
  /** … or a new place of the same request (`locations[].tempId`). */
  locationTempId?: string;
  /** UID of the ICS file (duplicate check of later imports). */
  externalUid: string | null;
  /** "" = no note. */
  note: string;
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
}

/** Body of `POST …/events/import` and `…/import/preview`. */
export interface ImportRequest {
  events: ImportEventPayload[];
  /** New places named in the file, created in the same transaction. */
  locations: { tempId: string; name: string }[];
  skipDuplicates?: boolean;
}

/** The backend imports at most this many events per request (413 `too_many_events` above). */
export const IMPORT_MAX = 5000;

/** tempId of a new place: its normalized name (the same name in the file is one place). */
function placeTempId(name: string): string {
  return `new:${norm(name)}`;
}

/** Request body of one event. */
export function toImportPayload(item: ImportItem, locations: Location[]): ImportEventPayload {
  const place = resolvePlace(item, locations);
  return {
    name: item.name.trim(),
    date: item.date,
    dateEnd: item.dateEnd && item.dateEnd > item.date ? item.dateEnd : null,
    isAllDay: item.isAllDay,
    timeBegin: item.timeBegin || (item.isAllDay ? "00:00" : "19:00"),
    timeEnd: item.timeEnd || (item.isAllDay ? "23:59" : "21:00"),
    timezone: item.timezone,
    isDraft: item.status === "draft",
    locationId: place.kind === "existing" ? place.id : null,
    ...(place.kind === "new" ? { locationTempId: placeTempId(place.name) } : {}),
    externalUid: item.uid || null,
    note: item.note,
    propertyIds: item.propertyIds,
    featureIds: item.featureIds,
    targetGroupIds: item.targetGroupIds,
  };
}

/**
 * One request for the given items (in their order) and the new places they need. The preview sends
 * all items of the file, the import the selected ones.
 */
export function toImportRequest(items: ImportItem[], locations: Location[]): ImportRequest {
  const places = new Map<string, string>();
  const events = items.map((item) => {
    const payload = toImportPayload(item, locations);
    const place = resolvePlace(item, locations);
    if (payload.locationTempId && place.kind === "new" && !places.has(payload.locationTempId))
      places.set(payload.locationTempId, place.name.trim());
    return payload;
  });
  return {
    events,
    locations: [...places].map(([tempId, name]) => ({ tempId, name })),
  };
}

/** What the backend's preview says about the items (by item id). */
export interface ImportCheck {
  duplicates: Set<string>;
  /** Items the backend would reject, with the first message. */
  invalid: Map<string, string>;
  warnings: ImportWarning[];
  /** Warnings by item id. */
  warningsOf: Map<string, ImportWarning[]>;
}

/** Maps the preview's entries (index = position in `items`) back to the items. */
export function checkFromPreview(
  items: Pick<ImportItem, "id">[],
  entries: ImportPreviewEntry[],
  warnings: ImportWarning[],
): ImportCheck {
  const duplicates = new Set<string>();
  const invalid = new Map<string, string>();
  for (const entry of entries) {
    const item = items[entry.index];
    if (!item) continue;
    if (entry.status === "duplicate") duplicates.add(item.id);
    else if (entry.status === "invalid") invalid.set(item.id, entry.errors[0]?.message ?? "");
  }
  const warningsOf = new Map<string, ImportWarning[]>();
  for (const warning of warnings) {
    const item = items[warning.index];
    if (!item) continue;
    warningsOf.set(item.id, [...(warningsOf.get(item.id) ?? []), warning]);
  }
  return { duplicates, invalid, warnings, warningsOf };
}

/** Distinct replaced time zones of the warnings ("US/Pacific-New" → the calendar's zone). */
export function replacedZones(warnings: ImportWarning[]): { zones: string[]; replacement: string } {
  const zones = [
    ...new Set(warnings.filter((w) => w.code === "timezone_replaced").map((w) => w.value ?? "")),
  ].filter(Boolean);
  const replacement = warnings.find((w) => w.code === "timezone_replaced")?.replacement ?? "";
  return { zones, replacement };
}
