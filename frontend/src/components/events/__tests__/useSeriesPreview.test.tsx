import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, apiPost } from "@/lib/api";
import { shouldRetry } from "@/lib/queryRetry";
import type { SeriesRule } from "@/lib/events";
import { useSeriesPreview } from "../useSeriesPreview";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiPost: vi.fn(),
}));

const rule: SeriesRule = {
  frequency: "weekly",
  weekday: 4,
  nth: null,
  startDate: "2026-11-01",
  until: "2026-11-30",
  count: null,
  skipHolidays: false,
};

beforeEach(() => {
  vi.mocked(apiPost).mockReset();
});

describe("useSeriesPreview", () => {
  it("shows a failed preview at once: no retries with the app's default query options", async () => {
    vi.mocked(apiPost).mockImplementation(() => Promise.reject(new ApiError("boom", 500)));
    // The app's default: 5xx errors are retried twice (back-off ~3 s) unless a query opts out.
    const client = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSeriesPreview("k1", rule, true), { wrapper });
    // Faster than the first retry would be (1 s back-off): waitFor gives up after 900 ms.
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 900 });
    expect((result.current.error as ApiError).status).toBe(500);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
