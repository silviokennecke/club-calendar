import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ConsentPage from "../ConsentPage";
import ProtectedRoute from "@/components/layout/ProtectedRoute";

const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiDelete: vi.fn(),
  apiErrorCode: (e: unknown) => (e as { code?: string }).code,
}));

const setUser = vi.fn();
const logout = vi.fn();
let auth: { user: unknown; loading: boolean };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ ...auth, setUser, logout }),
}));
vi.mock("@/components/legal/LegalLinks", () => ({ LegalLinks: () => null }));

const pending = [
  { type: "privacy", id: "p1", title: null, publishedAt: "2026-01-01T00:00:00Z" },
  { type: "terms", id: "t1", title: null, publishedAt: "2026-01-01T00:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth = {
    user: { id: "u", consentRequired: true, pendingConsents: pending },
    loading: false,
  };
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ConsentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConsentPage", () => {
  it("requires every pending document", async () => {
    renderPage();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole("button", { name: /Akzeptieren/ }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getAllByRole("checkbox")[0]).toHaveAttribute("aria-invalid", "true");
  });

  it("posts the ids and stores the new user", async () => {
    const me = { id: "u", consentRequired: false, pendingConsents: [] };
    apiPost.mockResolvedValue(me);
    renderPage();
    const user = userEvent.setup();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: /Akzeptieren/ }));
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(me));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/consents", { documentIds: ["p1", "t1"] });
  });

  it("reloads /me on consent_outdated", async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("x"), { status: 422, code: "consent_outdated" }),
    );
    const fresh = { id: "u", consentRequired: true, pendingConsents: pending };
    apiGet.mockResolvedValue(fresh);
    renderPage();
    const user = userEvent.setup();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: /Akzeptieren/ }));
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(fresh));
    expect(apiGet).toHaveBeenCalledWith("/api/auth/me");
    expect(await screen.findByText(/aktualisiert/)).toBeInTheDocument();
  });

  it("opens the delete account dialog with the password field", async () => {
    apiGet.mockResolvedValue({ id: "u", email: "a@b.de", hasPassword: true });
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: /Konto löschen/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/auth/me");
    expect(await screen.findByLabelText(/Zur Bestätigung dein Passwort/)).toBeInTheDocument();
  });

  it("opens the consent history modal and loads the list", async () => {
    apiGet.mockResolvedValue([
      {
        id: "r1",
        type: "privacy",
        documentId: "d1",
        documentTitle: null,
        documentPublishedAt: "2026-01-01T00:00:00Z",
        consentedAt: "2026-01-02T10:00:00Z",
        current: false,
        ipAddress: null,
        userAgent: null,
      },
    ]);
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: /Zustimmungshistorie/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("Datenschutzerklärung")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/auth/consents");
  });

  it("signs out", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
  });
});

describe("consent gate", () => {
  it("ProtectedRoute shows the consent page instead of the app", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/clubs"]}>
          <ProtectedRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Zustimmung erforderlich" }),
    ).toBeInTheDocument();
  });
});
