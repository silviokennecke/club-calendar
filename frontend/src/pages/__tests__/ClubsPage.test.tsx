import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ClubsPage from "../ClubsPage";

const apiGet = vi.fn();
const logout = vi.fn();
let authUser: Record<string, unknown> = {};

vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: authUser, logout }) }));

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderClubs(path = "/clubs") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clubs" element={<ClubsPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Counters come with GET /api/clubs (archived calendars are counted separately)
const clubs = [
  {
    id: "c1",
    name: "Schützenverein Waldblick",
    timezone: "Europe/Berlin",
    calendarCount: 2,
    archivedCalendarCount: 1,
    memberCount: 3,
  },
  {
    id: "c2",
    name: "Segelclub Möwe e. V.",
    timezone: "Europe/Berlin",
    calendarCount: 1,
    archivedCalendarCount: 0,
    memberCount: 1,
  },
];
const calendars: Record<string, unknown[]> = {
  c1: [
    { id: "k0", clubId: "c1", name: "Alt", archivedAt: "2025-01-01T00:00:00Z" },
    { id: "k1", clubId: "c1", name: "Schießbetrieb" },
    { id: "k2", clubId: "c1", name: "Jugend" },
  ],
  c2: [{ id: "k3", clubId: "c2", name: "Törns" }],
};
const members: Record<string, unknown[]> = {
  c1: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
  c2: [{ id: "u1" }],
};

function mockApi(clubList: unknown[] = clubs) {
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs") return Promise.resolve(clubList);
    const cal = path.match(/^\/api\/clubs\/([^/]+)\/calendars/);
    if (cal) return Promise.resolve(calendars[cal[1]] ?? []);
    const mem = path.match(/^\/api\/clubs\/([^/]+)\/members/);
    if (mem) return Promise.resolve(members[mem[1]] ?? []);
    return Promise.reject(new Error(path));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { name: "Alex Beispiel", email: "alex@beispiel.de" };
  mockApi();
});

describe("ClubsPage", () => {
  it("shows a loading state first", () => {
    renderClubs("/clubs?select=1");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("lists the clubs with counts, the last-used badge and a create card", async () => {
    authUser = { ...authUser, lastClubId: "c1", lastCalendarId: "k2" };
    renderClubs("/clubs?select=1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Wähle deinen Verein" }),
    ).toBeInTheDocument();
    const first = screen.getByRole("link", { name: "Schützenverein Waldblick" });
    // active calendars only; the last used calendar of the last club opens
    expect(first).toHaveAccessibleDescription("2 Kalender · 3 Mitglieder");
    expect(first).toHaveAttribute("href", "/clubs/c1/calendars/k2");
    expect(screen.getAllByText("Zuletzt genutzt")).toHaveLength(1);
    const second = screen.getByRole("link", { name: "Segelclub Möwe e. V." });
    expect(second).toHaveAccessibleDescription("1 Kalender · 1 Mitglied");
    // No calendar known yet: the club page; a click picks the calendar (below)
    expect(second).toHaveAttribute("href", "/clubs/c2");
  });

  it("loads no calendars or members per club (counts come with the club list)", async () => {
    renderClubs("/clubs?select=1");
    await screen.findByRole("link", { name: "Segelclub Möwe e. V." });
    expect(apiGet.mock.calls.map((c) => c[0])).toEqual(["/api/clubs"]);
  });

  it("links a club without any calendar to the setup step", async () => {
    mockApi([{ ...clubs[1], calendarCount: 0, archivedCalendarCount: 0 }]);
    renderClubs("/clubs?select=1");
    expect(await screen.findByRole("link", { name: "Segelclub Möwe e. V." })).toHaveAttribute(
      "href",
      "/setup?clubId=c2",
    );
    expect(screen.getByRole("link", { name: "Neuen Verein anlegen" })).toHaveAttribute(
      "href",
      "/setup?new=1",
    );
  });

  it("offers sign out in the header", async () => {
    renderClubs("/clubs?select=1");
    const header = (await screen.findByRole("banner")) as HTMLElement;
    expect(within(header).getByText("Alex Beispiel")).toBeInTheDocument();
    await userEvent.click(within(header).getByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
  });

  it("opens a club on click even before its calendars are loaded", async () => {
    renderClubs("/clubs?select=1");
    await userEvent.click(await screen.findByRole("link", { name: "Segelclub Möwe e. V." }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c2/calendars/k3");
  });

  it("opens the calendar last used in a club (membership, GET /api/clubs)", async () => {
    mockApi(
      [clubs[0], { ...clubs[1] }].map((c) => ({
        ...c,
        lastCalendarId: c.id === "c1" ? "k1" : null,
      })),
    );
    authUser = { ...authUser, lastClubId: "c2", lastCalendarId: "k3" };
    renderClubs("/clubs?select=1");
    const first = await screen.findByRole("link", { name: "Schützenverein Waldblick" });
    expect(first).toHaveAttribute("href", "/clubs/c1/calendars/k1");
    await userEvent.click(first);
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/calendars/k1");
  });

  it("ignores a remembered calendar that is archived or deleted", async () => {
    mockApi([{ ...clubs[0], lastCalendarId: "k0" }]);
    renderClubs("/clubs?select=1");
    await userEvent.click(await screen.findByRole("link", { name: "Schützenverein Waldblick" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/calendars/k1");
  });

  it("sends a club without calendars to the setup step", async () => {
    calendars.c2 = [];
    renderClubs("/clubs?select=1");
    await userEvent.click(await screen.findByRole("link", { name: "Segelclub Möwe e. V." }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/setup?clubId=c2");
    calendars.c2 = [{ id: "k3", clubId: "c2", name: "Törns" }];
  });

  it("shows an empty state with ?select=1 and no clubs", async () => {
    mockApi([]);
    renderClubs("/clubs?select=1");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Du bist noch in keinem Verein" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Neuen Verein anlegen" })).toHaveAttribute(
      "href",
      "/setup?new=1",
    );
  });

  it("shows an error when the clubs cannot be loaded", async () => {
    apiGet.mockRejectedValue(new Error("down"));
    renderClubs("/clubs?select=1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Vereine konnten nicht geladen werden",
    );
  });
});

describe("ClubsPage redirects", () => {
  it("opens the last club and calendar", async () => {
    authUser = { ...authUser, lastClubId: "c2", lastCalendarId: "k3" };
    renderClubs();
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c2/calendars/k3");
  });

  it("shows the list instead when ?select=1 is set", async () => {
    authUser = { ...authUser, lastClubId: "c2", lastCalendarId: "k3" };
    renderClubs("/clubs?select=1");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Wähle deinen Verein",
    );
  });

  it("shows the list when there is no last club", async () => {
    renderClubs();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Wähle deinen Verein",
    );
  });

  it("ignores a last club the user no longer belongs to", async () => {
    authUser = { ...authUser, lastClubId: "gone", lastCalendarId: "k9" };
    renderClubs();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Wähle deinen Verein",
    );
  });

  it("goes to the setup without clubs", async () => {
    mockApi([]);
    renderClubs();
    expect(await screen.findByTestId("location")).toHaveTextContent("/setup");
  });
});
