import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiErrorStatus: () => undefined }));

async function renderLinks() {
  const { LegalLinks } = await vi.importActual<typeof import("./LegalLinks")>("./LegalLinks");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/login"]}>
        <LegalLinks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LegalLinks", () => {
  it("links provided documents and disables missing ones", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      imprint: { id: "a", title: null, publishedAt: "2026-01-01T00:00:00Z" },
      privacy: { id: "b", title: null, publishedAt: "2026-01-01T00:00:00Z" },
      terms: null,
    });
    await renderLinks();
    expect(await screen.findByRole("link", { name: "Impressum" })).toHaveAttribute(
      "href",
      "/imprint",
    );
    expect(screen.getByRole("link", { name: "Datenschutz" })).toHaveAttribute("href", "/privacy");
    expect(screen.queryByRole("link", { name: "Nutzungsbedingungen" })).toBeNull();
    expect(screen.getByText("Nutzungsbedingungen")).toHaveAttribute("aria-disabled", "true");
  });

  it("is disabled while loading", async () => {
    vi.mocked(apiGet).mockReturnValue(new Promise(() => {}));
    await renderLinks();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Impressum")).toHaveAttribute("aria-disabled", "true");
  });
});
