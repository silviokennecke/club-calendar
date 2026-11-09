import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ApiError } from "@/lib/api";

const opaqueReauth = vi.fn();
vi.mock("../client", () => ({ opaqueReauth: (...a: unknown[]) => opaqueReauth(...a) }));

import { usePasswordProof } from "../useReauth";

const run = (password = "pw-12345") =>
  renderHook(() => usePasswordProof("delete-account")).result.current(password);

beforeEach(() => {
  opaqueReauth.mockReset();
});

describe("usePasswordProof", () => {
  it("returns the ticket for an account with an OPAQUE record", async () => {
    opaqueReauth.mockResolvedValue("t1");
    await expect(run()).resolves.toEqual({ reauthTicket: "t1" });
    expect(opaqueReauth).toHaveBeenCalledWith("delete-account", "pw-12345");
  });

  it.each(["opaque_not_registered", "opaque_unavailable"])(
    "falls back to the plain password on %s",
    async (code) => {
      opaqueReauth.mockRejectedValue(new ApiError("x", 409, code));
      await expect(run()).resolves.toEqual({ password: "pw-12345" });
    },
  );

  it("rethrows a wrong password instead of falling back", async () => {
    opaqueReauth.mockRejectedValue(new ApiError("x", 401, "invalid_credentials"));
    await expect(run()).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
