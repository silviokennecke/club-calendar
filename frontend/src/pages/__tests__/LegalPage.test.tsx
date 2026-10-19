import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LegalPage from "../LegalPage";
import { renderAt } from "./authTestUtils";
import { ApiError, apiGet } from "@/lib/api";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
}));

function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderAt(
    path,
    "/:type",
    <QueryClientProvider client={qc}>
      <LegalPage />
    </QueryClientProvider>,
  );
}

describe("LegalPage", () => {
  it("renders the backend HTML", async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path === "/api/legal/privacy"
        ? {
            id: "d1",
            type: "privacy",
            title: "Datenschutzerklärung",
            html: "<h2>Verantwortlich</h2><p>Der Verein</p>",
            publishedAt: "2026-05-01T00:00:00Z",
          }
        : { imprint: null, privacy: null, terms: null },
    );
    renderPage("/privacy");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Verantwortlich" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Datenschutzerklärung");
  });

  it("shows a not-provided message for 404", async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/legal/terms") throw new ApiError("nf", 404, "legal_document_not_found");
      return { imprint: null, privacy: null, terms: null };
    });
    renderPage("/terms");
    expect(
      await screen.findByText("Dieses Dokument wird nicht bereitgestellt."),
    ).toBeInTheDocument();
  });
});
