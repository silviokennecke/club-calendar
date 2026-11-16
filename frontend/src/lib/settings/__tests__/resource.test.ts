import { describe, expect, it } from "vitest";
import {
  hoursToMinutes,
  minutesToHours,
  validateResourceForm,
  EMPTY_RESOURCE_FORM,
} from "../resource";

describe("resource helpers", () => {
  it("converts full hours 0..24 to minutes", () => {
    expect(hoursToMinutes("0")).toBe(0);
    expect(hoursToMinutes("24")).toBe(1440);
    expect(hoursToMinutes("25")).toBeNull();
    expect(hoursToMinutes("1.5")).toBeNull();
    expect(hoursToMinutes("")).toBeNull();
    expect(hoursToMinutes("-1")).toBeNull();
  });

  it("rounds stored minutes to hours", () => {
    expect(minutesToHours(120)).toBe(2);
    expect(minutesToHours(0)).toBe(0);
  });

  it("validates create and edit", () => {
    expect(validateResourceForm(EMPTY_RESOURCE_FORM, true)).toEqual([
      "locationRequired",
      "nameRequired",
    ]);
    expect(validateResourceForm({ ...EMPTY_RESOURCE_FORM, name: "A" }, false)).toEqual([]);
  });
});
