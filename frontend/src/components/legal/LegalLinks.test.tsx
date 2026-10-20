import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiErrorStatus: () => undefined }));

async function renderLinks(path = "/login") {
  const { LegalLinks } = await vi.importActual<typeof import("./LegalLinks")>("./LegalLinks");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <LegalLinks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LegalLinks", () => {
  it("links provided documents and hides missing ones", async () => {
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
    expect(screen.queryByText("Nutzungsbedingungen")).toBeNull();
  });

  it("renders an externally linked document as a plain same-tab link, even on a secret feed", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      imprint: {
        id: "a",
        title: null,
        url: "https://example.org/impressum",
        publishedAt: "2026-01-01T00:00:00Z",
      },
      privacy: { id: "b", title: null, url: null, publishedAt: "2026-01-01T00:00:00Z" },
      terms: null,
    });
    await renderLinks("/feed/f1?secret=abc");
    const link = await screen.findByRole("link", { name: "Impressum" });
    expect(link).toHaveAttribute("href", "https://example.org/impressum");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).not.toHaveAttribute("target");
    expect(screen.getByRole("button", { name: "Datenschutz" })).toBeInTheDocument();
  });

  it("renders nothing while loading", async () => {
    vi.mocked(apiGet).mockReturnValue(new Promise(() => {}));
    await renderLinks();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText("Impressum")).toBeNull();
  });

  it("opens a local dialog (no link, no history state) on a feed with a secret", async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path === "/api/legal/privacy"
        ? {
            id: "b",
            type: "privacy",
            title: "Datenschutz",
            html: "<p>Text</p>",
            publishedAt: "2026-01-01T00:00:00Z",
          }
        : {
            imprint: null,
            privacy: { id: "b", title: null, publishedAt: "2026-01-01T00:00:00Z" },
            terms: null,
          },
    );
    await renderLinks("/feed/f1?secret=abc");
    const btn = await screen.findByRole("button", { name: "Datenschutz" });
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByText("Text")).toBeInTheDocument();
  });

  it("renders nothing when no documents are available", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      imprint: null,
      privacy: null,
      terms: null,
    });
    await renderLinks();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryAllByText(/Impressum|Datenschutz|Nutzungsbedingungen/)).toHaveLength(0);
  });
});
