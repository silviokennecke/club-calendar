import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { requestPasswordReset } from "../passwordReset";

const apiPost = vi.fn();
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

beforeEach(() => apiPost.mockReset());

describe("requestPasswordReset", () => {
  it("reports 'sent' for 204 and for rate limits (no account oracle)", async () => {
    apiPost.mockResolvedValueOnce(undefined);
    expect(await requestPasswordReset("a@b.de")).toBe("sent");
    expect(apiPost).toHaveBeenCalledWith("/api/auth/forgot-password", { email: "a@b.de" });
    apiPost.mockRejectedValueOnce(new ApiError("Too Many Requests", 429));
    expect(await requestPasswordReset("a@b.de")).toBe("sent");
  });

  it("tells invalid addresses and failures apart", async () => {
    apiPost.mockRejectedValueOnce(new ApiError("x", 422, "validation_failed"));
    expect(await requestPasswordReset("nope")).toBe("invalid_email");
    apiPost.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await requestPasswordReset("a@b.de")).toBe("failed");
    apiPost.mockRejectedValueOnce(new ApiError("x", 500));
    expect(await requestPasswordReset("a@b.de")).toBe("failed");
  });
});
