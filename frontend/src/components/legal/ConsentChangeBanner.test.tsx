import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { ConsentChangeBanner } from "./ConsentChangeBanner";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiErrorCode: (e: unknown) => (e as { code?: string })?.code,
  apiErrorStatus: () => undefined,
}));

const setUser = vi.fn();
const refreshUser = vi.fn();
let user: Record<string, unknown> | null;
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user, setUser, refreshUser }),
}));

const privacy = { type: "privacy", id: "p1", title: "Datenschutz", publishedAt: "2026-01-01" };
const terms = { type: "terms", id: "t1", title: "AGB", publishedAt: "2026-01-01" };

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConsentChangeBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConsentChangeBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    user = { id: "u", pendingConsents: [privacy], consentRequired: false };
  });

  it("is shown for pending documents without a gate", () => {
    renderBanner();
    expect(screen.getByText(/Datenschutzerklärung/)).toBeInTheDocument();
  });

  it.each([
    ["no pending documents", { pendingConsents: [], consentRequired: false }],
    ["gate active", { pendingConsents: [privacy], consentRequired: true }],
    ["field missing", {}],
  ])("is hidden with %s", (_n, patch) => {
    user = { id: "u", ...patch };
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("stays dismissed for the same ids but returns for a new version", () => {
    const first = renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    expect(renderBanner().container).toBeEmptyDOMElement();
    user = { id: "u", pendingConsents: [{ ...privacy, id: "p2" }], consentRequired: false };
    const again = renderBanner();
    expect(again.container).not.toBeEmptyDOMElement();
  });

  it("survives unavailable sessionStorage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderBanner();
    expect(screen.getByRole("button", { name: "Später" })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("posts the ids on accept, updates the user and hides the banner", async () => {
    user = { id: "u", pendingConsents: [privacy, terms], consentRequired: false };
    const me = { id: "u", pendingConsents: [], consentRequired: false };
    vi.mocked(apiPost).mockResolvedValue(me);
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Prüfen und akzeptieren" }));
    const boxes = await screen.findAllByRole("checkbox");
    boxes.forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole("button", { name: /Akzeptieren und fortfahren/ }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/consents", { documentIds: ["p1", "t1"] }),
    );
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(me));
  });

  it("links a linked document in a new tab inside the dialog", async () => {
    user = {
      id: "u",
      pendingConsents: [{ ...privacy, url: "https://example.org/datenschutz" }],
      consentRequired: false,
    };
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Prüfen und akzeptieren" }));
    const link = await screen.findByRole("link", { name: "Datenschutzerklärung" });
    expect(link).toHaveAttribute("href", "https://example.org/datenschutz");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("requires every checkbox", async () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Prüfen und akzeptieren" }));
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /Akzeptieren und fortfahren/ }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("refreshes the user and shows an error on consent_outdated", async () => {
    vi.mocked(apiPost).mockRejectedValue({ code: "consent_outdated" });
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Prüfen und akzeptieren" }));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Akzeptieren und fortfahren/ }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(await screen.findByText(/in der Zwischenzeit/)).toBeInTheDocument();
    expect(setUser).not.toHaveBeenCalled();
  });

  it("opens a document inside the dialog", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      id: "p1",
      type: "privacy",
      title: null,
      html: "<p>Inhalt der Erklärung</p>",
      publishedAt: "2026-01-01T00:00:00Z",
    });
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Prüfen und akzeptieren" }));
    fireEvent.click(await screen.findByRole("button", { name: "Datenschutzerklärung" }));
    expect(await screen.findByText("Inhalt der Erklärung")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/legal/documents/p1");
    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    expect(await screen.findByRole("checkbox")).toBeInTheDocument();
  });
});
