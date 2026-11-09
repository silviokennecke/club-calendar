import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import FeedJoinPage from "../FeedJoinPage";
import { ApiError } from "@/lib/api";
import { readFeedProof, stashFeedProof } from "@/lib/feeds/feedProof";

const apiGet = vi.fn();
const apiPost = vi.fn();
const updateUser = vi.fn();
let auth: { user: unknown; loading: boolean };

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ ...auth, updateUser }) }));
vi.mock("@/components/feed/usePublicFeed", () => ({
  usePublicFeed: () => ({ data: { feed: { name: "Schießtermine" } } }),
}));

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(url = "/feed/f1/join") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/feed/:feedId/join" element={<FeedJoinPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const membership = (over: Record<string, unknown> = {}) => ({
  clubId: null,
  clubName: "Schützen",
  isClubMember: false,
  hasFeedAccess: false,
  canJoin: true,
  canClaim: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth = { user: { id: "u1" }, loading: false };
  updateUser.mockResolvedValue(true);
  apiGet.mockResolvedValue(membership());
});

describe("FeedJoinPage", () => {
  it("sends a signed-out visitor to the login and keeps the proof", async () => {
    auth = { user: null, loading: false };
    renderPage();
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: undefined });
  });

  it("moves the secret out of the address bar into the stash", async () => {
    renderPage("/feed/f1/join?secret=abc");
    await screen.findByRole("button", { name: "Beitreten" });
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: "abc" });
    expect(apiGet).toHaveBeenCalledWith("/api/feed/f1/membership?secret=abc");
  });

  it("asks for explicit confirmation, then claims and opens Mein Verein", async () => {
    stashFeedProof({ feedId: "f1", secret: "abc" });
    apiPost.mockResolvedValue({ clubId: "c1", clubName: "Schützen", feedId: "f1", joined: true });
    renderPage();
    expect(await screen.findByText(/Mitglied im Verein „Schützen“/)).toBeInTheDocument();
    expect(screen.getByText(/„Schießtermine“/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Beitreten" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/feed/f1/claim", { secret: "abc" }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/me");
    expect(readFeedProof()).toBeNull();
  });

  it("existing members confirm an add, not a join", async () => {
    apiGet.mockResolvedValue(membership({ isClubMember: true, hasFeedAccess: true }));
    renderPage();
    expect(await screen.findByRole("button", { name: "Hinzufügen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Beitreten" })).toBeNull();
  });

  it("cancel returns to the feed page with the secret and drops the stash", async () => {
    stashFeedProof({ feedId: "f1", secret: "abc" });
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/feed/f1?secret=abc");
    expect(readFeedProof()).toBeNull();
  });

  it("explains a club that does not accept members through the feed", async () => {
    apiGet.mockResolvedValue(membership({ canJoin: false }));
    renderPage();
    expect(await screen.findByText(/keine neuen Mitglieder auf/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Beitreten" })).toBeNull();
  });

  it("shows feed not found for an unknown feed or wrong secret", async () => {
    apiGet.mockRejectedValue(new ApiError("x", 404, "feed_not_found"));
    renderPage();
    expect(await screen.findByText(/nicht gefunden oder der Link/)).toBeInTheDocument();
  });

  it("maps a failing claim to its message and keeps the page usable", async () => {
    apiPost.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Beitreten" }));
    expect(await screen.findByText(/Zu viele Versuche/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beitreten" })).toBeEnabled();
  });

  it("a claim refused with member_signup_disabled ends in the dead state", async () => {
    apiPost.mockRejectedValue(new ApiError("x", 403, "member_signup_disabled"));
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Beitreten" }));
    expect(await screen.findByText(/keine neuen Mitglieder auf/)).toBeInTheDocument();
  });

  it("sends an unconfirmed address to the code page and keeps the stash", async () => {
    auth = { user: { id: "u1", emailVerificationRequired: true }, loading: false };
    stashFeedProof({ feedId: "f1" });
    renderPage();
    expect(await screen.findByTestId("location")).toHaveTextContent("/verify-email");
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: undefined });
  });

  it("lets the consent gate come first", async () => {
    auth = { user: { id: "u1", consentRequired: true }, loading: false };
    renderPage();
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
    expect(readFeedProof()).not.toBeNull();
  });
});
