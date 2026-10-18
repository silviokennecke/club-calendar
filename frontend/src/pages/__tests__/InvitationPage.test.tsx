import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import InvitationPage from "../InvitationPage";
import { ApiError } from "@/lib/api";
import { readInvitationToken, stashInvitationToken } from "@/lib/invitations";

const apiGet = vi.fn();
const apiPost = vi.fn();
const updateUser = vi.fn();
let auth: { user: unknown; loading: boolean };

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ ...auth, updateUser }),
}));

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/invitations" element={<InvitationPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const problem = (status: number, code: string) => new ApiError("x", status, code);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth = { user: { id: "u1" }, loading: false };
  updateUser.mockResolvedValue(true);
  apiGet.mockResolvedValue([{ id: "k1", name: "Kalender" }]);
});

describe("InvitationPage", () => {
  it("keeps the token for the sign-in and sends a signed-out visitor to the login", async () => {
    auth = { user: null, loading: false };
    renderPage("/invitations?token=secret");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(readInvitationToken()).toBe("secret");
  });

  it("moves the token out of the address bar and shows a neutral question", async () => {
    renderPage("/invitations?token=secret");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Einladung zu einem Verein" }),
    ).toBeInTheDocument();
    expect(readInvitationToken()).toBe("secret");
    expect(screen.getByRole("button", { name: "Annehmen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ablehnen" })).toBeInTheDocument();
  });

  it("uses the token kept across the sign-in (no token in the URL)", async () => {
    stashInvitationToken("kept");
    apiPost.mockResolvedValue({ id: "c1", name: "Waldblick", timezone: "Europe/Berlin" });
    renderPage("/invitations");
    await userEvent.click(await screen.findByRole("button", { name: "Annehmen" }));
    expect(apiPost).toHaveBeenCalledWith("/api/invitations/accept", { token: "kept" });
  });

  it("accepts, forgets the token, switches to the club and opens its calendar", async () => {
    apiPost.mockResolvedValue({ id: "c1", name: "Waldblick", timezone: "Europe/Berlin" });
    renderPage("/invitations?token=secret");
    await userEvent.click(await screen.findByRole("button", { name: "Annehmen" }));
    expect(apiPost).toHaveBeenCalledWith("/api/invitations/accept", { token: "secret" });
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/calendars/k1");
    expect(updateUser).toHaveBeenCalledWith({ lastClubId: "c1", lastCalendarId: "k1" });
    expect(readInvitationToken()).toBeNull();
  });

  it("declines and confirms it", async () => {
    apiPost.mockResolvedValue(undefined);
    renderPage("/invitations?token=secret");
    await userEvent.click(await screen.findByRole("button", { name: "Ablehnen" }));
    expect(apiPost).toHaveBeenCalledWith("/api/invitations/decline", { token: "secret" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Einladung abgelehnt" }),
    ).toBeInTheDocument();
    expect(readInvitationToken()).toBeNull();
  });

  it.each([
    ["invitation_not_found", 404, "ungültig, abgelaufen oder für ein anderes Konto bestimmt"],
    ["invitation_expired", 422, "Die Einladung ist abgelaufen."],
    ["quota_exceeded", 422, "höchste Mitgliederzahl"],
  ])("explains %s and drops the dead token", async (code, status, text) => {
    apiPost.mockRejectedValue(problem(status, code));
    renderPage("/invitations?token=secret");
    await userEvent.click(await screen.findByRole("button", { name: "Annehmen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByRole("button", { name: "Annehmen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu meinen Vereinen" })).toBeInTheDocument();
    expect(readInvitationToken()).toBeNull();
  });

  it("keeps the token and the buttons after a temporary failure", async () => {
    apiPost.mockRejectedValue(new Error("network"));
    renderPage("/invitations?token=secret");
    await userEvent.click(await screen.findByRole("button", { name: "Annehmen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Das hat nicht geklappt");
    expect(screen.getByRole("button", { name: "Annehmen" })).toBeEnabled();
    expect(readInvitationToken()).toBe("secret");
  });

  it("'decide later' forgets the token and goes to the club picker", async () => {
    renderPage("/invitations?token=secret");
    await userEvent.click(await screen.findByRole("button", { name: "Später entscheiden" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/clubs?select=1"),
    );
    expect(readInvitationToken()).toBeNull();
  });

  it("sends a signed-in visitor without any token to the club picker", async () => {
    renderPage("/invitations");
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
  });
});
