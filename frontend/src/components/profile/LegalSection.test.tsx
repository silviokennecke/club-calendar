import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LegalSection } from "./LegalSection";

const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { dateFormat: "dd.MM.yyyy" } }),
}));

const record = {
  id: "c1",
  type: "privacy",
  documentId: "d1",
  documentTitle: "Datenschutz",
  documentPublishedAt: "2026-01-05T10:00:00Z",
  consentedAt: "2026-02-03T10:00:00Z",
  current: false,
  ipAddress: "203.0.113.7",
  userAgent: "TestAgent/1.0",
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LegalSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LegalSection", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/auth/consents") return [record];
      if (path === "/api/legal/documents/d1")
        return {
          id: "d1",
          type: "privacy",
          title: "Datenschutz",
          html: "<p>Alter Text</p>",
          publishedAt: record.documentPublishedAt,
        };
      return { imprint: null, privacy: null, terms: null };
    });
  });

  it("is collapsed and does not load the history until opened", async () => {
    const { container } = renderSection();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(apiGet).not.toHaveBeenCalledWith("/api/auth/consents");
    await userEvent.click(screen.getByText("Rechtliches & Einwilligungen"));
    expect(details.open).toBe(true);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/auth/consents"));
    expect(await screen.findByText("Veraltet")).toBeInTheDocument();
    expect(screen.getByText(/Fassung vom 05\.01\.2026/)).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7 · TestAgent/1.0")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    apiGet.mockImplementation(async (path: string) =>
      path === "/api/auth/consents" ? [] : { imprint: null, privacy: null, terms: null },
    );
    renderSection();
    await userEvent.click(screen.getByText("Rechtliches & Einwilligungen"));
    expect(await screen.findByText("Noch keine Einwilligungen")).toBeInTheDocument();
  });

  it("opens the exact version in a dialog", async () => {
    renderSection();
    await userEvent.click(screen.getByText("Rechtliches & Einwilligungen"));
    await userEvent.click(await screen.findByRole("button", { name: /ansehen/ }));
    expect(await screen.findByText("Alter Text")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/legal/documents/d1");
  });
});
