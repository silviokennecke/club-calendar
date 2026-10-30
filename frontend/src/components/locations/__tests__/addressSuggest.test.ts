import { describe, expect, it } from "vitest";
import { EMPTY_LOCATION_FORM } from "@/lib/settings";
import { blurFillPatch, type AddressSuggestion } from "../addressSuggest";

const hit = (over: Partial<AddressSuggestion> = {}): AddressSuggestion => ({
  label: "x",
  lat: 1,
  lng: 2,
  zip: "12345",
  city: "Musterstadt",
  country: "Deutschland",
  ...over,
});

describe("blurFillPatch", () => {
  it("fills address and position from a single hit", () => {
    expect(blurFillPatch(EMPTY_LOCATION_FORM, [hit()])).toEqual({
      zip: "12345",
      city: "Musterstadt",
      country: "Deutschland",
      latitude: 1,
      longitude: 2,
    });
  });

  it("keeps an existing position", () => {
    const form = { ...EMPTY_LOCATION_FORM, latitude: 5, longitude: 6 };
    expect(blurFillPatch(form, [hit()])).not.toHaveProperty("latitude");
  });

  it("fills only shared values of a complete list", () => {
    const patch = blurFillPatch(EMPTY_LOCATION_FORM, [hit(), hit({ zip: "9", city: "Andere" })]);
    expect(patch).toEqual({ country: "Deutschland" });
  });

  it("fills nothing when the list is full", () => {
    expect(
      blurFillPatch(
        EMPTY_LOCATION_FORM,
        Array.from({ length: 6 }, () => hit()),
      ),
    ).toEqual({});
  });

  it("fills nothing when an address field is already set", () => {
    expect(blurFillPatch({ ...EMPTY_LOCATION_FORM, city: "A" }, [hit()])).toEqual({});
  });
});
