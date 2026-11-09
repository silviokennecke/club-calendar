import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ApiError } from "@/lib/api";

const opaqueReauth = vi.fn();
const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
}));
vi.mock("../client", () => ({ opaqueReauth: (...a: unknown[]) => opaqueReauth(...a) }));

import { usePasswordProof } from "../useReauth";
import { opaqueFailureKind } from "../auth";

const run = (password = "pw-12345") =>
  renderHook(() => usePasswordProof("delete-account")).result.current(password);

beforeEach(() => {
  opaqueReauth.mockReset();
  apiGet.mockReset();
  apiGet.mockResolvedValue({ passwordProtocol: "opaque" });
});

describe("usePasswordProof", () => {
  it("returns the ticket for an account with an OPAQUE record", async () => {
    opaqueReauth.mockResolvedValue("t1");
    await expect(run()).resolves.toEqual({ reauthTicket: "t1" });
    expect(opaqueReauth).toHaveBeenCalledWith("delete-account", "pw-12345");
  });

  it("sends the plain password without any OPAQUE request for legacy only", async () => {
    apiGet.mockResolvedValue({ passwordProtocol: "legacy" });
    await expect(run()).resolves.toEqual({ password: "pw-12345" });
    expect(opaqueReauth).not.toHaveBeenCalled();
  });

  it.each(["reset_required", null, undefined])("never sends plaintext for %s", async (protocol) => {
    apiGet.mockResolvedValue({ passwordProtocol: protocol });
    await expect(run()).rejects.toBeDefined();
    expect(opaqueReauth).not.toHaveBeenCalled();
  });

  it("reset_required maps to the reset notice", async () => {
    apiGet.mockResolvedValue({ passwordProtocol: "reset_required" });
    const err = await run().catch((e) => e);
    expect(opaqueFailureKind(err)).toBe("reset_required");
  });

  it.each(["opaque_not_registered"])("does not fall back to plaintext on %s", async (code) => {
    opaqueReauth.mockRejectedValue(new ApiError("x", 409, code));
    await expect(run()).rejects.toMatchObject({ code });
  });

  it("maps opaque_required to a message", () => {
    expect(opaqueFailureKind(new ApiError("x", 409, "opaque_required"))).toBe("reload");
  });

  it("rethrows a wrong password instead of falling back", async () => {
    opaqueReauth.mockRejectedValue(new ApiError("x", 401, "invalid_credentials"));
    await expect(run()).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
