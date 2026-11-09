import { describe, expect, it } from "vitest";
import { MAX_BATCH, parseEmailList } from "../assignments";

describe("parseEmailList", () => {
  it("splits at whitespace, commas and semicolons, lower-cases and de-duplicates", () => {
    const r = parseEmailList("A@x.de, a@x.de;\n<b@x.de>  c@x.de");
    expect(r.emails).toEqual(["a@x.de", "b@x.de", "c@x.de"]);
    expect(r.invalid).toEqual([]);
  });

  it("reports entries that are no address", () => {
    const r = parseEmailList("a@x.de Anna kein-at");
    expect(r.emails).toEqual(["a@x.de"]);
    expect(r.invalid).toEqual(["anna", "kein-at"]);
  });

  it("flags more than the batch limit", () => {
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `u${i}@x.de`).join("\n");
    expect(parseEmailList(many).tooMany).toBe(true);
    expect(parseEmailList("a@x.de").tooMany).toBe(false);
  });
});
