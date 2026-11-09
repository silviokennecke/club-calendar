import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SubscribeButton } from "../SubscribeButton";
import { useFeedAccount } from "../useFeedAccount";
import { AuthContext, type AuthContextValue } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { readFeedProof } from "@/lib/feeds/feedProof";

const apiGet = vi.fn();
const claimFeed = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (path: string, body: unknown) => claimFeed(path, body),
}));

const addresses = { ics: "https://x/ics", webcal: "webcal://x/ics" };
const SIGNED_IN = { user: { id: "u1", name: "Alex" }, loading: false } as AuthContextValue;
const CLUB = { id: "c1", name: "Schützen", timezone: "Europe/Berlin", role: "member" };

interface State {
  membership?: unknown;
  membershipError?: unknown;
  feedSelected?: boolean;
}

function mockApi({ membership, membershipError, feedSelected = false }: State) {
  apiGet.mockImplementation((path: string) => {
    if (path.includes("/membership")) {
      return membershipError ? Promise.reject(membershipError) : Promise.resolve(membership);
    }
    if (path === "/api/clubs") return Promise.resolve([CLUB]);
    if (path.endsWith("/my-feeds"))
      return Promise.resolve({
        feeds: [{ id: "f1", name: "F", selected: feedSelected }],
        targetGroups: [],
      });
    return Promise.reject(new Error(path));
  });
}

const info = (over: Record<string, unknown>) => ({
  clubName: "Schützen",
  isClubMember: false,
  hasFeedAccess: false,
  canJoin: false,
  canClaim: false,
  ...over,
});

function Button({ secret }: { secret?: string }) {
  const account = useFeedAccount("f1", secret);
  return <SubscribeButton addresses={addresses} name="F" account={account} />;
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderButton(auth: AuthContextValue | null, secret?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/feed/f1"]}>
          <Routes>
            <Route path="/feed/f1" element={<Button secret={secret} />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const main = () => screen.getAllByRole("button")[0];
const openMenu = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /Weitere Wege/ }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("account entry of the subscribe button", () => {
  it("signed out: subscribe stays the main action, the account option stashes the proof and signs in", async () => {
    renderButton({ user: null, loading: false } as AuthContextValue, "sec");
    expect(main()).toHaveTextContent("Kalender abonnieren");
    const user = userEvent.setup();
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Zu meinem Konto hinzufügen" }));
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: "sec" });
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("member with the feed in the account: shows it by default, subscribing stays in the menu", async () => {
    mockApi({ membership: info({ isClubMember: true, hasFeedAccess: true }), feedSelected: true });
    renderButton(SIGNED_IN);
    await waitFor(() => expect(main()).toHaveTextContent("In meinem Konto anzeigen"));
    const user = userEvent.setup();
    await openMenu(user);
    expect(screen.getByRole("button", { name: "Kalender abonnieren" })).toBeInTheDocument();
    await user.click(main());
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/me");
  });

  it("member without the feed in the account: adds it directly, no confirmation", async () => {
    mockApi({ membership: info({ isClubMember: true, hasFeedAccess: true }), feedSelected: false });
    claimFeed.mockResolvedValue({
      clubId: "c1",
      clubName: "Schützen",
      feedId: "f1",
      joined: false,
    });
    renderButton(SIGNED_IN, "sec");
    await waitFor(() => expect(main()).toHaveTextContent("Zu meinem Konto hinzufügen"));
    await userEvent.setup().click(main());
    await waitFor(() =>
      expect(claimFeed).toHaveBeenCalledWith("/api/feed/f1/claim", { secret: "sec" }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/me");
  });

  it("staff with a private feed they can claim: adds it directly", async () => {
    mockApi({ membership: info({ isClubMember: true, canClaim: true }) });
    renderButton(SIGNED_IN, "sec");
    await waitFor(() => expect(main()).toHaveTextContent("Zu meinem Konto hinzufügen"));
  });

  it("not a member: goes to the join page with the proof stashed", async () => {
    mockApi({ membership: info({ canJoin: true }) });
    renderButton(SIGNED_IN, "sec");
    await waitFor(() => expect(main()).toHaveTextContent("Zu meinem Konto hinzufügen"));
    await userEvent.setup().click(main());
    expect(await screen.findByTestId("location")).toHaveTextContent("/feed/f1/join");
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: "sec" });
    expect(claimFeed).not.toHaveBeenCalled();
  });

  it("hides the option when the club does not accept members through the feed", async () => {
    mockApi({ membership: info({}) });
    renderButton(SIGNED_IN);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(main()).toHaveTextContent("Kalender abonnieren");
    await openMenu(userEvent.setup());
    expect(screen.queryByRole("button", { name: /Konto/ })).toBeNull();
  });

  it("hides the option for an unknown feed (404)", async () => {
    mockApi({ membershipError: new ApiError("x", 404, "feed_not_found") });
    renderButton(SIGNED_IN, "wrong");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await openMenu(userEvent.setup());
    expect(screen.queryByRole("button", { name: /Konto/ })).toBeNull();
  });
});
