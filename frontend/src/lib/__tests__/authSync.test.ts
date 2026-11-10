import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBroadcastChannel } from "./authTestUtils";

vi.mock("../sessionEnd", () => ({ markSessionEnded: vi.fn() }));

type Api = typeof import("../api");

function tokenResponse(access: string, refresh: string) {
  return new Response(JSON.stringify({ access_token: access, refresh_token: refresh }), {
    status: 200,
  });
}

/** A fresh module instance = another tab (own memory), sharing localStorage and the fake channel. */
async function openTab(): Promise<Api> {
  vi.resetModules();
  return import("../api");
}

const fetchMock = vi.fn<typeof fetch>();
const storageSnapshot = () => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]);

beforeEach(() => {
  FakeBroadcastChannel.install();
  FakeBroadcastChannel.sent = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { href: "/clubs" });
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
});

describe("token storage", () => {
  it("keeps the access token in memory only and the refresh token in localStorage", async () => {
    const api = await openTab();
    api.storeTokens("access-1", "refresh-1");
    expect(api.getAccessToken()).toBe("access-1");
    expect(localStorage.getItem("refresh_token")).toBe("refresh-1");
    expect(storageSnapshot()).not.toContain("access-1");
    expect(sessionStorage.length).toBe(0);
  });

  it("never sends the refresh token over the channel", async () => {
    const api = await openTab();
    api.storeTokens("access-1", "refresh-secret");
    api.broadcastLogout();
    expect(JSON.stringify(FakeBroadcastChannel.sent)).not.toContain("refresh-secret");
    expect(FakeBroadcastChannel.sent).toContainEqual({ type: "tokens", accessToken: "access-1" });
  });

  it("migrates legacy sessionStorage tokens to localStorage and removes them", async () => {
    sessionStorage.setItem("refresh_token", "legacy-r");
    sessionStorage.setItem("access_token", "legacy-a");
    sessionStorage.setItem("accessToken", "legacy-a2");
    sessionStorage.setItem("sso_code_verifier", "keep");
    const api = await openTab();
    expect(localStorage.getItem("refresh_token")).toBe("legacy-r");
    expect(sessionStorage.getItem("refresh_token")).toBeNull();
    expect(sessionStorage.getItem("access_token")).toBeNull();
    expect(sessionStorage.getItem("accessToken")).toBeNull();
    expect(sessionStorage.getItem("sso_code_verifier")).toBe("keep");
    expect(api.getAccessToken()).toBeNull();
    expect(api.hasSession()).toBe(true);
  });

  it("does not overwrite an existing localStorage refresh token on migration", async () => {
    localStorage.setItem("refresh_token", "current");
    sessionStorage.setItem("refresh_token", "legacy-r");
    await openTab();
    expect(localStorage.getItem("refresh_token")).toBe("current");
    expect(sessionStorage.getItem("refresh_token")).toBeNull();
  });
});

describe("startup and refresh lock", () => {
  it("ensureAccessToken refreshes when only a refresh token exists", async () => {
    localStorage.setItem("refresh_token", "r1");
    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    const api = await openTab();
    await expect(api.ensureAccessToken()).resolves.toBe(true);
    expect(api.getAccessToken()).toBe("a2");
    expect(localStorage.getItem("refresh_token")).toBe("r2");
    expect(storageSnapshot()).not.toContain("a2");
  });

  it("ensureAccessToken is false without any token", async () => {
    const api = await openTab();
    await expect(api.ensureAccessToken()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ensureAccessToken rejects (keeps the session) on a 500", async () => {
    localStorage.setItem("refresh_token", "r1");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const api = await openTab();
    await expect(api.ensureAccessToken()).rejects.toMatchObject({ status: 0 });
    expect(localStorage.getItem("refresh_token")).toBe("r1");
  });

  it("works without navigator.locks (plain single flight)", async () => {
    expect(navigator.locks).toBeUndefined();
    localStorage.setItem("refresh_token", "r1");
    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    const api = await openTab();
    await Promise.all([api.refreshSession(), api.refreshSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the cc-refresh lock when available", async () => {
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    localStorage.setItem("refresh_token", "r1");
    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    const api = await openTab();
    await api.refreshSession();
    expect(request).toHaveBeenCalledWith("cc-refresh", expect.any(Function));
  });

  it("a second tab adopts the token another tab rotated instead of refreshing again", async () => {
    // tab B has a session; tab A will rotate the token while B waits for the lock
    const tabB = await openTab();
    tabB.storeTokens("a1", "r1");
    const tabA = await openTab();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_n: string, fn: () => Promise<unknown>) => (await gate, fn()) },
    });
    fetchMock.mockResolvedValue(tokenResponse("never", "never"));

    const pending = tabB.refreshSession();
    // meanwhile tab A refreshed: new refresh token in storage, access token broadcast
    localStorage.setItem("refresh_token", "r2");
    tabA.storeTokens("a2", "r2");
    await Promise.resolve();
    await Promise.resolve();
    release();

    await expect(pending).resolves.toBe("a2");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tabB.getAccessToken()).toBe("a2");
  });
});

describe("logout sync", () => {
  it("a logout broadcast clears the other tab without calling the API or echoing", async () => {
    const tabB = await openTab();
    tabB.storeTokens("a1", "r1");
    const listener = vi.fn();
    tabB.onRemoteSignOut(listener);
    const tabA = await openTab();
    FakeBroadcastChannel.sent = [];

    tabA.broadcastLogout();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledOnce();
    expect(tabB.getAccessToken()).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeBroadcastChannel.sent).toEqual([{ type: "logout" }]);
  });

  it("removal of the refresh token in another tab (storage event) signs this tab out", async () => {
    const api = await openTab();
    api.storeTokens("a1", "r1");
    const listener = vi.fn();
    api.onRemoteSignOut(listener);
    localStorage.removeItem("refresh_token");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "refresh_token", oldValue: "r1", newValue: null }),
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(api.getAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a rotation (storage event with a new value) is not a logout", async () => {
    const api = await openTab();
    api.storeTokens("a1", "r1");
    const listener = vi.fn();
    api.onRemoteSignOut(listener);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "refresh_token", oldValue: "r1", newValue: "r2" }),
    );
    expect(listener).not.toHaveBeenCalled();
    expect(api.getAccessToken()).toBe("a1");
  });

  it("a tab without a session ignores broadcast tokens", async () => {
    const idle = await openTab();
    const other = await openTab();
    other.storeTokens("a1", "r1");
    await Promise.resolve();
    await Promise.resolve();
    expect(idle.getAccessToken()).toBeNull();
  });
});
