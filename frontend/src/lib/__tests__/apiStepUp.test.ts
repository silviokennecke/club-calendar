import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiPost, clearTokens, isStepUpCancelled, storeTokens } from "../api";
import {
  cancelStepUp,
  completeStepUp,
  clearStepUp,
  getStepUpToken,
  isStepUpPrompting,
} from "../stepUp";

const fetchMock = vi.fn<typeof fetch>();
let sent: Record<string, string>[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  sent = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ ...(init?.headers as Record<string, string>) });
    return fetchMock(input, init);
  });
  clearTokens();
  clearStepUp();
  storeTokens("access", "refresh");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokens();
});

describe("apiFetch step-up", () => {
  it("sends the stored token on auth routes", async () => {
    completeStepUp("tok", 600);
    fetchMock.mockResolvedValue(json(200, {}));
    await apiPost("/api/auth/change-email", {});
    expect(sent[0]["X-Step-Up-Token"]).toBe("tok");
  });

  it("does not send it to other routes", async () => {
    completeStepUp("tok", 600);
    fetchMock.mockResolvedValue(json(200, {}));
    await apiPost("/api/clubs", {});
    expect(sent[0]["X-Step-Up-Token"]).toBeUndefined();
  });

  it("opens the confirmation on step_up_required and retries once with the token", async () => {
    fetchMock
      .mockResolvedValueOnce(json(403, { code: "step_up_required", status: 403 }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const pending = apiPost<{ ok: boolean }>("/api/auth/change-email", { a: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(isStepUpPrompting()).toBe(true));
    completeStepUp("fresh", 600);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(sent[0]["X-Step-Up-Token"]).toBeUndefined();
    expect(sent[1]["X-Step-Up-Token"]).toBe("fresh");
    expect(getStepUpToken()).toBe("fresh");
  });

  it("rejects with step_up_cancelled when the dialog is cancelled", async () => {
    fetchMock.mockResolvedValueOnce(json(403, { code: "step_up_required", status: 403 }));
    const pending = apiPost("/api/auth/change-email", {});
    const caught = pending.catch((e) => e);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(isStepUpPrompting()).toBe(true));
    cancelStepUp();
    expect(isStepUpCancelled(await caught)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the access token and retries on step_up_unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(json(403, { code: "step_up_unavailable", status: 403 }))
      .mockResolvedValueOnce(json(200, { access_token: "new", refresh_token: "r2" }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(apiPost("/api/auth/step-up", {})).resolves.toEqual({ ok: true });
    expect(sent[2]["Authorization"]).toBe("Bearer new");
  });
});
