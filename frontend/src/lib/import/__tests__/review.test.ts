import { describe, expect, it } from "vitest";
import type { Location } from "@/lib/types";
import type { ParsedIcsEvent } from "../ics";
import {
  OTHERS_GROUP,
  applyIds,
  buildItems,
  chunk,
  commonIds,
  commonStatus,
  findDuplicates,
  groupItems,
  groupPlace,
  matchLocation,
  newPlaceKey,
  patchItems,
  placeFromValue,
  placeToValue,
  resolvePlace,
  selectionState,
  summarizeImport,
  toImportPayload,
  withoutLeadingIcons,
} from "../review";

function ev(name: string, date: string, extra: Partial<ParsedIcsEvent> = {}): ParsedIcsEvent {
  return {
    uid: `${name}-${date}`,
    name,
    date,
    dateEnd: "",
    isAllDay: false,
    timeBegin: "19:00",
    timeEnd: "21:00",
    timezone: null,
    locationText: "",
    recurring: false,
    ...extra,
  };
}

const haus: Location = {
  id: "l1",
  calendarid: "k1",
  name: "Schützenhaus Waldblick",
  street: "Waldstraße 12",
  zip: "12345",
  city: "Musterstadt",
};
const locations = [haus];

const parsed = [
  ev("Training", "2026-10-08"),
  ev("Herbstfest", "2026-10-24", { locationText: "Gasthof Zur Linde" }),
  ev("Training", "2026-10-01", { locationText: "schützenhaus  waldblick" }),
  ev("Sitzung", "2026-10-07"),
];

describe("buildItems / groupItems", () => {
  it("sorts by date and groups events sharing a name; singles go to 'others'", () => {
    const items = buildItems(parsed);
    expect(items.map((i) => i.date)).toEqual([
      "2026-10-01",
      "2026-10-07",
      "2026-10-08",
      "2026-10-24",
    ]);
    expect(items.every((i) => i.selected && i.status === "draft")).toBe(true);
    const groups = groupItems(items);
    expect(groups.map((g) => [g.key, g.items.length, g.showName])).toEqual([
      ["Training", 2, false],
      [OTHERS_GROUP, 2, true],
    ]);
    expect(groups[0].name).toBe("Training");
    expect(groups[1].name).toBeNull();
  });

  it("shows names again when a group's items differ after editing", () => {
    const items = patchItems(buildItems(parsed), (i) => i.id === "i1", { name: "Training A" });
    const group = groupItems(items).find((g) => g.key === "Training")!;
    expect(group.showName).toBe(true);
  });
});

describe("selection", () => {
  it("reports all / some / none", () => {
    const items = buildItems(parsed);
    expect(selectionState(items)).toBe("all");
    expect(selectionState(patchItems(items, (i) => i.id === "i1", { selected: false }))).toBe(
      "some",
    );
    expect(selectionState(patchItems(items, () => true, { selected: false }))).toBe("none");
  });
});

describe("places", () => {
  it("matches by name, street, address or name prefix", () => {
    expect(matchLocation("Schützenhaus Waldblick", locations)?.id).toBe("l1");
    expect(matchLocation("waldstraße 12", locations)?.id).toBe("l1");
    expect(matchLocation("Waldstraße 12, 12345 Musterstadt", locations)?.id).toBe("l1");
    expect(matchLocation("Schützenhaus Waldblick, Waldstr. 12", locations)?.id).toBe("l1");
    expect(matchLocation("Gasthof Zur Linde", locations)).toBeUndefined();
    expect(matchLocation("", locations)).toBeUndefined();
  });

  it("resolves existing, new and none, and honours overrides", () => {
    // ids follow the file order: i3 = Training 10-01 with matching text, i2 = Herbstfest, i4 = Sitzung
    const byId = (id: string) => buildItems(parsed).find((i) => i.id === id)!;
    const [a, b, c] = [byId("i3"), byId("i2"), byId("i4")];
    expect(resolvePlace(a, locations)).toEqual({ kind: "existing", id: "l1" });
    expect(resolvePlace(b, locations)).toEqual({ kind: "new", name: "Gasthof Zur Linde" });
    expect(resolvePlace(c, locations)).toEqual({ kind: "none" });
    expect(
      resolvePlace({ ...b, placeOverride: { kind: "existing", id: "l1" } }, locations),
    ).toEqual({
      kind: "existing",
      id: "l1",
    });
    expect(
      resolvePlace({ ...b, placeOverride: { kind: "existing", id: "gone" } }, locations),
    ).toEqual({
      kind: "none",
    });
  });

  it("summarizes the place of a group", () => {
    const items = buildItems(parsed);
    const training = groupItems(items)[0].items;
    expect(groupPlace(training, locations)).toEqual("mixed");
    const same = patchItems(training, () => true, {
      placeOverride: { kind: "existing", id: "l1" },
    });
    expect(groupPlace(same, locations)).toEqual({ kind: "existing", id: "l1" });
  });

  it("round-trips the select value", () => {
    for (const p of [
      { kind: "none" as const },
      { kind: "existing" as const, id: "l1" },
      { kind: "new" as const, name: "Gasthof: Zur Linde" },
    ]) {
      expect(placeFromValue(placeToValue(p))).toEqual(p);
    }
  });
});

describe("bulk edits", () => {
  it("adds and removes only what changed", () => {
    let items = buildItems(parsed);
    items = patchItems(items, (i) => i.id === "i1", { targetGroupIds: ["g1"] });
    const all = () => true;
    const ids = (list: typeof items) =>
      Object.fromEntries(list.map((i) => [i.id, i.targetGroupIds]));
    items = applyIds(items, all, "targetGroupIds", [], ["g2"]);
    expect(ids(items)).toEqual({ i1: ["g1", "g2"], i2: ["g2"], i3: ["g2"], i4: ["g2"] });
    expect(commonIds(items, "targetGroupIds")).toEqual(["g2"]);
    items = applyIds(items, all, "targetGroupIds", ["g2"], []);
    expect(ids(items)).toEqual({ i1: ["g1"], i2: [], i3: [], i4: [] });
    expect(applyIds(items, all, "featureIds", [], [])).toBe(items);
  });

  it("applies to matching items only and avoids duplicates", () => {
    let items = buildItems(parsed);
    items = applyIds(items, (i) => i.id === "i1", "propertyIds", [], ["p1"]);
    items = applyIds(items, (i) => i.id === "i1", "propertyIds", [], ["p1"]);
    expect(items.find((i) => i.id === "i1")!.propertyIds).toEqual(["p1"]);
    expect(items.find((i) => i.id === "i2")!.propertyIds).toEqual([]);
  });

  it("derives the common status", () => {
    const items = buildItems(parsed);
    expect(commonStatus(items)).toBe("draft");
    expect(
      commonStatus(patchItems(items, (i) => i.id === "i1", { status: "published" })),
    ).toBeNull();
    expect(commonStatus([])).toBeNull();
  });
});

describe("duplicates and summary", () => {
  it("finds events with the same name and day", () => {
    const items = buildItems(parsed);
    const dup = findDuplicates(items, [
      { name: " herbstfest ", date: "2026-10-24T00:00:00+00:00" },
      { name: "Training", date: "2026-10-02" },
    ]);
    expect([...dup]).toEqual(["i2"]);
  });

  it("matches names exported with property icons (round trip of the ICS export)", () => {
    const items = buildItems([
      ev("🎯 👔 Herbstfest", "2026-10-24"),
      ev("Training", "2026-10-02"),
      ev("🎄 Weihnachtsfeier", "2026-12-20"),
      ev("🎯", "2026-11-01"),
    ]);
    const dup = findDuplicates(items, [
      { name: "Herbstfest", date: "2026-10-24T00:00:00+00:00" },
      { name: "🎯 Training", date: "2026-10-02" },
      { name: "Weihnachtsfeier", date: "2026-12-20" },
      { name: "Wanderung", date: "2026-11-01" },
    ]);
    expect(items.filter((i) => dup.has(i.id)).map((i) => i.name)).toEqual([
      "Training",
      "🎯 👔 Herbstfest",
      "🎄 Weihnachtsfeier",
    ]);
  });

  it("only strips leading icons, never other characters of a name", () => {
    expect(withoutLeadingIcons("🎯 Training 2026 ★")).toBe("Training 2026 ★");
    expect(withoutLeadingIcons("1. Mai-Feier")).toBe("1. Mai-Feier");
    expect(withoutLeadingIcons("🎯")).toBe("🎯");
    expect(withoutLeadingIcons("🇩🇪 Tag")).toBe("Tag");
  });

  it("counts selection, statuses and new places", () => {
    let items = buildItems(parsed);
    items = patchItems(items, (i) => i.id === "i4", { selected: false });
    items = patchItems(items, (i) => i.id === "i2", { status: "published" });
    expect(summarizeImport(items, locations)).toEqual({
      selected: 3,
      total: 4,
      unselected: 1,
      drafts: 2,
      published: 1,
      newPlaces: ["Gasthof Zur Linde"],
    });
  });
});

describe("payload", () => {
  it("builds the request body with resolved location ids", () => {
    const items = buildItems(parsed);
    const ids = new Map([[newPlaceKey("Gasthof Zur Linde"), "l9"]]);
    const fest = items.find((i) => i.name === "Herbstfest")!;
    expect(toImportPayload(fest, locations, ids)).toEqual({
      name: "Herbstfest",
      date: "2026-10-24",
      dateEnd: null,
      isAllDay: false,
      timeBegin: "19:00",
      timeEnd: "21:00",
      timezone: null,
      isDraft: true,
      locationId: "l9",
      propertyIds: [],
      featureIds: [],
      targetGroupIds: [],
    });
    const training = items[0];
    expect(toImportPayload(training, locations, ids).locationId).toBe("l1");
    expect(
      toImportPayload({ ...training, dateEnd: "2026-10-01" }, locations, ids).dateEnd,
    ).toBeNull();
  });

  it("chunks lists", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
