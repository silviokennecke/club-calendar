import { describe, expect, it } from "vitest";
import { sortByName, sortTargetGroupRefs } from "@/lib/sortByName";

describe("sortByName", () => {
  it("sorts case-insensitively and locale-aware without mutating", () => {
    const input = [
      { name: "jugend" },
      { name: "Zwerge" },
      { name: "Ärzte" },
      { name: "Erwachsene" },
    ];
    expect(sortByName(input, "de").map((g) => g.name)).toEqual([
      "Ärzte",
      "Erwachsene",
      "jugend",
      "Zwerge",
    ]);
    expect(input[0]!.name).toBe("jugend");
  });

  it("sorts target group refs", () => {
    const refs = [{ targetGroup: { name: "b" } }, { targetGroup: { name: "A" } }];
    expect(sortTargetGroupRefs(refs, "en").map((r) => r.targetGroup.name)).toEqual(["A", "b"]);
  });
});
