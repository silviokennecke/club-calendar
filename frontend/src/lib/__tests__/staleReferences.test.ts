import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import { isUnknownIdError, keepExisting, saveDroppingDeletedReferences } from "../staleReferences";

describe("staleReferences", () => {
  it("recognises the backend's unknown-id answer only", () => {
    expect(
      isUnknownIdError(new ApiError('propertyIds: unknown id "x" in this calendar', 422)),
    ).toBe(true);
    expect(isUnknownIdError(new ApiError("timezone must be a valid IANA time zone", 422))).toBe(
      false,
    );
    expect(isUnknownIdError(new ApiError('unknown id "x"', 400))).toBe(false);
    expect(isUnknownIdError(new Error("unknown id"))).toBe(false);
  });

  it("keeps existing ids in their order", () => {
    expect(keepExisting(["a", "b", "c"], new Set(["c", "a"]))).toEqual(["a", "c"]);
  });

  it("saves once more without the deleted ids after an unknown-id answer", async () => {
    const qc = new QueryClient();
    qc.fetchQuery = vi.fn().mockResolvedValue([{ id: "keep" }]) as typeof qc.fetchQuery;
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('propertyIds: unknown id "gone" in this calendar', 422))
      .mockResolvedValueOnce({ id: "saved" });
    const result = await saveDroppingDeletedReferences(
      qc,
      "cal",
      ["properties"],
      { propertyIds: ["keep", "gone"] },
      send,
      (b, existing) => ({ propertyIds: keepExisting(b.propertyIds, existing.properties) }),
    );
    expect(result).toEqual({ id: "saved" });
    expect(send).toHaveBeenLastCalledWith({ propertyIds: ["keep"] });
  });

  it("passes other errors on without a second try", async () => {
    const send = vi.fn().mockRejectedValue(new ApiError("Bad Request", 400));
    await expect(
      saveDroppingDeletedReferences(new QueryClient(), "cal", ["properties"], {}, send, (b) => b),
    ).rejects.toThrow("Bad Request");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
