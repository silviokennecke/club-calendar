import { describe, expect, it } from "vitest";
import { dateFormatChoices, providerLabel, providerRows } from "..";

describe("dateFormatChoices", () => {
  it("shows an example date for every format", () => {
    expect(dateFormatChoices()).toEqual([
      { value: "dd.MM.yyyy", example: "31.12.2026" },
      { value: "dd/MM/yyyy", example: "31/12/2026" },
      { value: "MM/dd/yyyy", example: "12/31/2026" },
      { value: "yyyy-MM-dd", example: "2026-12-31" },
    ]);
  });
});

describe("providerRows", () => {
  const offered = [
    { id: "google", name: "Google" },
    { id: "microsoft", name: "Microsoft" },
  ];
  it("lists linked accounts first, then the other offered providers", () => {
    expect(providerRows([{ provider: "microsoft" }], offered)).toEqual([
      { id: "microsoft", name: "Microsoft", linked: true },
      { id: "google", name: "Google", linked: false },
    ]);
  });
  it("keeps a linked provider the server no longer offers", () => {
    expect(providerRows([{ provider: "apple" }, { provider: "apple" }], [])).toEqual([
      { id: "apple", name: "Apple", linked: true },
    ]);
  });
  it("is empty without any provider", () => {
    expect(providerRows([], [])).toEqual([]);
    expect(providerLabel("")).toBe("");
  });
});
