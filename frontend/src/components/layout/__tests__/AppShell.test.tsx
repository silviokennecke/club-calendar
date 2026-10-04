import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../AppShell";
import { rememberLastCalendar } from "@/lib/lastCalendar";

const apiGet = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Alex Beispiel", lastClubId: "c1", lastCalendarId: "k1" },
    logout: vi.fn(),
    updateUser,
  }),
}));

const clubs = [
  { id: "c1", name: "Schützenverein Waldblick", timezone: "Europe/Berlin" },
  { id: "c2", name: "Segelclub Möwe", timezone: "Europe/Berlin" },
];
const calendarsOf: Record<string, unknown[]> = {
  c1: [{ id: "k1", name: "Schießbetrieb" }],
  c2: [
    { id: "s1", name: "Regatta 2026" },
    { id: "s2", name: "Jugendtraining" },
    { id: "s0", name: "Saison 2025", archivedAt: "2026-01-01T00:00:00Z" },
  ],
};

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderShell(clubId: string, calendarId: string | null, retryOff = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: !retryOff } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/clubs/${clubId}/calendars/${calendarId ?? ""}`]}>
        <Routes>
          <Route
            path="/clubs/:clubId/calendars/:calendarId"
            element={<AppShell clubId={clubId} calendarId={calendarId} trackLastUsed />}
          >
            <Route
              index
              element={
                <>
                  <p>Inhalt</p>
                  <Probe />
                </>
              }
            />
          </Route>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  updateUser.mockReset();
  updateUser.mockResolvedValue(true);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs") return Promise.resolve(clubs);
    const m = /^\/api\/clubs\/([^/]+)\/calendars/.exec(path);
    if (m) {
      if (!calendarsOf[m[1]]) return Promise.reject(Object.assign(new Error("x"), { status: 404 }));
      return Promise.resolve(calendarsOf[m[1]]);
    }
    return Promise.resolve([]);
  });
});

async function switchTo(clubName: RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Verein.*Waldblick/ }));
  const panel = screen.getByRole("region", { name: "Verein wechseln" });
  await user.click(within(panel).getByRole("button", { name: clubName }));
}

describe("AppShell club switch", () => {
  it("opens the calendar last used in the target club (remembered in this browser)", async () => {
    rememberLastCalendar("u1", "c2", "s2");
    renderShell("c1", "k1");
    await switchTo(/Möwe/);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/clubs/c2/calendars/s2"),
    );
  });

  it("falls back to the first active calendar when nothing (valid) is remembered", async () => {
    rememberLastCalendar("u1", "c2", "s0"); // archived
    renderShell("c1", "k1");
    await switchTo(/Möwe/);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/clubs/c2/calendars/s1"),
    );
  });

  it("ignores what another account remembered in the same browser", async () => {
    rememberLastCalendar("u2", "c2", "s2");
    renderShell("c1", "k1");
    await switchTo(/Möwe/);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/clubs/c2/calendars/s1"),
    );
  });

  it("remembers the calendar it shows for the club", async () => {
    renderShell("c1", "k1");
    await screen.findByText("Inhalt");
    await waitFor(() => expect(window.localStorage.getItem("lastCalendar:u1:c1")).toBe("k1"));
  });
});

describe("AppShell unavailable club", () => {
  it("shows 'Nicht verfügbar' with a way back instead of 'Laden…' for a foreign club", async () => {
    renderShell("foreign", "kx");
    const link = await screen.findByRole("link", { name: "Zur Vereinsauswahl" });
    expect(link).toHaveAttribute("href", "/clubs?select=1");
    expect(screen.queryByText("Laden…")).toBeNull();
    expect(screen.getAllByText("Nicht verfügbar").length).toBeGreaterThan(0);
    // No redirect to the onboarding because the calendars could not be loaded.
    expect(screen.getByTestId("location")).toHaveTextContent("/clubs/foreign/calendars/kx");
  });
});
