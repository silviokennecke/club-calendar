import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock("@/lib/appName", async (orig) => await orig<typeof import("@/lib/appName")>());

import { useAppName } from "../appName";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAppName", () => {
  it("returns the instance name from the backend, the default while loading", async () => {
    apiGet.mockResolvedValue({ restricted: false, appName: "Mein Verein" });
    const { result } = renderHook(() => useAppName(), { wrapper });
    expect(result.current).toBe("Club Calendar");
    await waitFor(() => expect(result.current).toBe("Mein Verein"));
  });

  it("falls back to the default when the request fails", async () => {
    apiGet.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useAppName(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe("Club Calendar");
  });
});
