import { describe, it, expect } from "vitest";
import { rankByRelevance } from "../fuzzySearch";

const items = [
  { id: "1", label: "Vorstandssitzung" },
  { id: "2", label: "Die Jahreshauptversammlung" },
  { id: "3", label: "Jahreshauptversammlung" },
  { id: "4", label: "Müller Pokal" },
  { id: "5", label: "Sommerfest" },
];

describe("rankByRelevance", () => {
  it("returns nothing for an empty query", () => {
    expect(rankByRelevance(items, "  ", ["label"])).toEqual([]);
  });

  it("ranks prefix matches above substring matches", () => {
    const result = rankByRelevance(items, "jahres", ["label"]).map((i) => i.id);
    expect(result.slice(0, 2)).toEqual(["3", "2"]);
  });

  it("is case and diacritic insensitive", () => {
    expect(rankByRelevance(items, "MULLER", ["label"]).map((i) => i.id)).toEqual(["4"]);
    expect(rankByRelevance(items, "müller", ["label"]).map((i) => i.id)).toEqual(["4"]);
  });

  it("tolerates a small typo and ranks it after exact matches", () => {
    const withTypo = [...items, { id: "6", label: "Sommerfeste" }];
    const result = rankByRelevance(withTypo, "sommerfset", ["label"]).map((i) => i.id);
    expect(result).toContain("5");
  });

  it("filters out unrelated items", () => {
    expect(rankByRelevance(items, "xyzq", ["label"])).toEqual([]);
  });

  it("searches several keys", () => {
    const rows = [{ id: "a", label: "Halle", city: "Bremen" }];
    expect(rankByRelevance(rows, "brem", ["label", "city"])).toHaveLength(1);
  });
});
