import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../AppShell";
import { buildNavGroups, buildTabs } from "../navigation";
import type { ClubRole } from "@/lib/types";

const apiGet = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock("@/lib/registration", () => ({
  useClubCreationAllowed: () => ({ allowed: true, loading: false }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Alex Beispiel", lastClubId: null, lastCalendarId: null },
    logout: vi.fn(),
    updateUser,
  }),
}));

let roles: Record<string, ClubRole>;

function Probe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/clubs/:clubId/*"
            element={<AppShell clubId={path.split("/")[2]} calendarId={null} />}
          >
            <Route
              path="*"
              element={
                <>
                  <p>Inhalt</p>
                  <Probe />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  roles = { m1: "member", a1: "admin" };
  apiGet.mockReset();
  updateUser.mockReset();
  updateUser.mockResolvedValue(true);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs")
      return Promise.resolve(
        Object.entries(roles).map(([id, role]) => ({
          id,
          name: id === "m1" ? "Mitgliederverein" : "Adminverein",
          timezone: "Europe/Berlin",
          role,
        })),
      );
    if (/\/calendars/.test(path)) return Promise.resolve([{ id: "k1", name: "Hauptkalender" }]);
    return Promise.resolve([]);
  });
});

describe("AppShell for a plain member", () => {
  it("never requests calendars and shows only Mein Verein", async () => {
    renderAt("/clubs/m1/me");
    await screen.findByText("Inhalt");
    const nav = await screen.findByRole("navigation", { name: "Bereiche" });
    expect(nav.querySelectorAll("a")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Mein Verein" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Kalender wechseln")).toBeNull();
    expect(screen.queryByRole("link", { name: "Veröffentlichen" })).toBeNull();
    expect(apiGet.mock.calls.some(([p]) => /calendars/.test(String(p)))).toBe(false);
    expect(screen.getByTestId("location")).toHaveTextContent("/clubs/m1/me");
  });

  it.each(["/clubs/m1", "/clubs/m1/calendars/k1", "/clubs/m1/settings/feeds"])(
    "redirects %s to Mein Verein",
    async (path) => {
      renderAt(path);
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/clubs/m1/me"));
      expect(apiGet.mock.calls.some(([p]) => /calendars/.test(String(p)))).toBe(false);
    },
  );

  it("remembers the club as last used without a calendar", async () => {
    renderAt("/clubs/m1/me");
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ lastClubId: "m1", lastCalendarId: null }),
    );
  });
});

describe("AppShell for a member with calendar permissions", () => {
  beforeEach(() => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/api/clubs")
        return Promise.resolve([
          {
            id: "m1",
            name: "Mitgliederverein",
            timezone: "Europe/Berlin",
            role: "member",
            calendars: [{ id: "k1", name: "Hauptkalender", timezone: null, archivedAt: null }],
          },
        ]);
      return Promise.resolve([]);
    });
  });

  function renderCalendar(path: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const calendarId = path.split("/")[4] ?? null;
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/clubs/:clubId/*"
              element={<AppShell clubId="m1" calendarId={calendarId} />}
            >
              <Route
                path="*"
                element={
                  <>
                    <p>Inhalt</p>
                    <Probe />
                  </>
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("opens a permitted calendar and its read-only settings, without requesting the calendar list", async () => {
    renderCalendar("/clubs/m1/calendars/k1/settings/holiday-calendars");
    await screen.findByText("Inhalt");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/clubs/m1/calendars/k1/settings/holiday-calendars",
    );
    expect(apiGet.mock.calls.some(([p]) => /calendars/.test(String(p)))).toBe(false);
    const nav = await screen.findByRole("navigation", { name: "Bereiche" });
    const labels = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
    expect(labels).toContain("Mein Verein");
    expect(labels).not.toContain("Veröffentlichen");
    expect(labels).not.toContain("Verein");
    expect(screen.getAllByText("Hauptkalender").length).toBeGreaterThan(0);
  });

  it.each([
    "/clubs/m1/calendars/k2",
    "/clubs/m1/calendars/k1/settings/permissions",
    "/clubs/m1/settings/locations",
  ])("still redirects %s to Mein Verein", async (path) => {
    renderCalendar(path);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/clubs/m1/me"));
  });

  it("shows the calendar entries for Mein Verein, too", async () => {
    renderCalendar("/clubs/m1/me");
    await screen.findByText("Inhalt");
    const nav = await screen.findByRole("navigation", { name: "Bereiche" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toContain(
      "Alle Termine",
    );
  });
});

describe("AppShell for staff", () => {
  it("loads the calendars and offers the admin areas next to Mein Verein", async () => {
    renderAt("/clubs/a1/me");
    await screen.findByText("Inhalt");
    await waitFor(() =>
      expect(apiGet.mock.calls.some(([p]) => /\/api\/clubs\/a1\/calendars/.test(String(p)))).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Veröffentlichen" }).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByRole("link", { name: "Mein Verein" }).length).toBeGreaterThan(0);
  });
});

describe("navigation per role", () => {
  it("gives a member only Mein Verein in the sidebar and the tab bar", () => {
    const groups = buildNavGroups("c1", null, "member");
    expect(groups.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/clubs/c1/me"]);
    expect(buildTabs("c1", null, "member").map((t) => t.key)).toEqual(["me"]);
  });

  it.each<ClubRole>(["viewer", "editor", "admin"])("keeps the staff navigation for %s", (role) => {
    const hrefs = buildNavGroups("c1", "k1", role).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/clubs/c1/me");
    expect(hrefs).toContain("/clubs/c1/calendars/k1/events");
    expect(buildTabs("c1", "k1", role).map((t) => t.key)).not.toContain("me");
  });
});
