import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FeedsPage from "../settings/FeedsPage";
import MasterListPage from "../settings/MasterListPage";
import CalendarSettingsPage from "../settings/CalendarSettingsPage";
import EventsListPage from "../events/EventsListPage";
import { CalendarsSection } from "@/components/club/CalendarsSection";
import { ClubNameSection } from "@/components/club/ClubNameSection";
import { buildNavGroups, buildTabs } from "@/components/layout/navigation";
import { BASE, PATTERN, renderRoute } from "../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";
import type { ClubRole } from "@/lib/types";

const apiGet = vi.fn();

vi.mock("@/lib/api", () => ({
  BACKEND_URL: "https://api.example.org",
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", dateFormat: "dd.MM.yyyy", firstDayOfWeek: 1 } }),
}));

const calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: null };

function mockAs(role: ClubRole) {
  mockApiGet(
    apiGet,
    (path: string) => {
      if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
      return Promise.resolve([]);
    },
    role,
  );
}

beforeEach(() => apiGet.mockReset());

describe("events list by club role", () => {
  const route = `${PATTERN}/events`;
  it("shows no create button to a viewer", async () => {
    mockAs("viewer");
    renderRoute(route, `${BASE}/events`, <EventsListPage />);
    await screen.findByRole("heading", { name: "Alle Termine" });
    await screen.findByText(/Noch keine Termine|Keine Termine/);
    expect(screen.queryByRole("button", { name: /Termin anlegen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Termin anlegen/ })).not.toBeInTheDocument();
  });

  it("offers creating to an editor", async () => {
    mockAs("editor");
    renderRoute(route, `${BASE}/events`, <EventsListPage />);
    expect(
      (await screen.findAllByRole("button", { name: /Termin anlegen/ })).length,
    ).toBeGreaterThan(0);
  });
});

describe("reference data settings by club role", () => {
  const route = `${PATTERN}/settings/properties`;
  it("is read-only for a viewer", async () => {
    mockAs("viewer");
    renderRoute(route, `${BASE}/settings/properties`, <MasterListPage kind="properties" />);
    await screen.findByText(/Deine Rolle in diesem Verein erlaubt nur das Ansehen\./);
    expect(screen.queryByRole("button", { name: /anlegen|hinzufügen/i })).not.toBeInTheDocument();
  });
});

describe("feeds by club role", () => {
  const route = `${PATTERN}/settings/feeds`;
  const url = `${BASE}/settings/feeds`;

  it("hides the feeds from a viewer and does not load them", async () => {
    mockAs("viewer");
    renderRoute(route, url, <FeedsPage />);
    expect(
      await screen.findByRole("heading", { name: "Feeds sind für deine Rolle nicht verfügbar" }),
    ).toBeInTheDocument();
    expect(apiGet.mock.calls.some(([p]) => String(p).includes("/feeds"))).toBe(false);
  });

  it("lets an editor view but not manage feeds", async () => {
    mockAs("editor");
    renderRoute(route, url, <FeedsPage />);
    expect(await screen.findByText(/Nur Vereins-Admins können Feeds/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Feed anlegen" })).not.toBeInTheDocument();
  });

  it("lets an admin create feeds", async () => {
    mockAs("admin");
    renderRoute(route, url, <FeedsPage />);
    expect((await screen.findAllByRole("link", { name: "Feed anlegen" })).length).toBeGreaterThan(
      0,
    );
  });
});

describe("calendar settings by club role", () => {
  const route = `${PATTERN}/settings`;
  it("keeps the calendar name read-only for an editor", async () => {
    mockAs("editor");
    renderRoute(route, `${BASE}/settings`, <CalendarSettingsPage />);
    const name = await screen.findByDisplayValue("Schießbetrieb 2026");
    expect(name).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
  });
});

function renderClub(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("club page sections by club role", () => {
  const club = (role: ClubRole) => ({ id: "c1", name: "Verein", timezone: "Europe/Berlin", role });
  const cal = { id: "k1", clubId: "c1", name: "Schießbetrieb", timezone: null };

  it("lets an editor open calendars but not manage them or rename the club", async () => {
    apiGet.mockResolvedValue([cal]);
    renderClub(
      <>
        <ClubNameSection club={club("editor")} />
        <CalendarsSection club={club("editor")} />
      </>,
    );
    expect(
      await screen.findByRole("link", { name: /Schießbetrieb.*öffnen|öffnen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kalender anlegen/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /duplizieren|archivieren|löschen/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveAttribute("readonly");
  });

  it("shows an admin everything", async () => {
    apiGet.mockResolvedValue([cal]);
    renderClub(
      <>
        <ClubNameSection club={club("admin")} />
        <CalendarsSection club={club("admin")} />
      </>,
    );
    expect(
      await screen.findByRole("button", { name: /Schießbetrieb.*archivieren/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kalender anlegen/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Name/ })).not.toHaveAttribute("readonly");
  });
});

describe("navigation by club role", () => {
  const keys = (role?: ClubRole) =>
    buildNavGroups("c1", "k1", role).flatMap((g) => g.items.map((i) => i.key));
  it("hides import and feeds from viewers and while the role is unknown", () => {
    for (const role of ["viewer", undefined] as const) {
      expect(keys(role)).not.toContain("import");
      expect(keys(role)).not.toContain("feeds");
      expect(buildTabs("c1", "k1", role).map((t) => t.key)).not.toContain("feeds");
    }
  });
  it("shows them to editors", () => {
    expect(keys("editor")).toEqual(expect.arrayContaining(["import", "feeds"]));
    expect(buildTabs("c1", "k1", "editor").map((t) => t.key)).toContain("feeds");
  });
});
