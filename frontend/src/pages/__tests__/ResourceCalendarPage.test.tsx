import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import ResourceCalendarPage from "../ResourceCalendarPage";
import type { ShellData } from "@/components/layout/shellTypes";

const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", firstDayOfWeek: 1 } }),
}));

function shell(role: string): ShellData {
  return {
    clubs: [{ id: "c1", name: "Verein", timezone: "Europe/Berlin", role }],
    calendars: [],
    clubId: "c1",
    calendarId: null,
    userName: "Alex",
    onSelectClub: vi.fn(),
    onLogout: vi.fn(),
  } as unknown as ShellData;
}

function renderPage(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/clubs/c1/resources/r1/calendar?date=2026-10-08"]}>
        <Routes>
          <Route element={<Outlet context={shell(role)} />}>
            <Route
              path="/clubs/:clubId/resources/:resourceId/calendar"
              element={<ResourceCalendarPage />}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const staffItem = {
  id: "e1",
  name: "Training",
  calendarId: "k1",
  calendarName: "Schießbetrieb",
  date: "2026-10-08",
  dateEnd: null,
  timeBegin: "19:00",
  timeEnd: "21:00",
  isAllDay: false,
  timezone: "Europe/Berlin",
  isDraft: false,
};
const busyItem = {
  calendarName: "Schießbetrieb",
  date: "2026-10-08",
  dateEnd: null,
  timeBegin: "19:00",
  timeEnd: "21:00",
  isAllDay: false,
  timezone: "Europe/Berlin",
};

let eventsResult: () => Promise<unknown>;
let listResult: unknown[];

beforeEach(() => {
  apiGet.mockReset();
  listResult = [{ id: "r1", name: "Schützenhaus" }];
  eventsResult = () => Promise.resolve([staffItem]);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/resources") return Promise.resolve(listResult);
    if (path.startsWith("/api/clubs/c1/resources/r1/events")) return eventsResult();
    return Promise.resolve([]);
  });
});

describe("ResourceCalendarPage", () => {
  it("shows event and calendar name for staff and requests the visible range", async () => {
    renderPage("editor");
    expect(await screen.findByRole("heading", { name: "Schützenhaus" })).toBeInTheDocument();
    const grid = await screen.findByRole("grid", { name: "Oktober 2026" });
    expect(await within(grid).findAllByText(/Training · Schießbetrieb/)).not.toHaveLength(0);
    const call = apiGet.mock.calls.map((c) => c[0] as string).find((p) => p.includes("/events"))!;
    expect(call).toMatch(/events\?from=2026-09-28&to=2026-11-0\d$/);
  });

  it("shows busy-only items as Belegt", async () => {
    eventsResult = () => Promise.resolve([busyItem]);
    renderPage("member");
    const grid = await screen.findByRole("grid", { name: "Oktober 2026" });
    expect(await within(grid).findAllByText(/Belegt · Schießbetrieb/)).not.toHaveLength(0);
    expect(screen.queryByText(/Training/)).not.toBeInTheDocument();
  });

  it("switches to the week view", async () => {
    renderPage("viewer");
    await screen.findByRole("grid", { name: "Oktober 2026" });
    await userEvent.click(screen.getByRole("link", { name: "Woche" }));
    expect(await screen.findByRole("heading", { name: /KW 41/ })).toBeInTheDocument();
  });

  it("shows the not-found state on resource_not_found", async () => {
    eventsResult = () => Promise.reject(Object.assign(new Error("nf"), { status: 404 }));
    listResult = [];
    renderPage("member");
    expect(await screen.findByText("Ressource nicht gefunden")).toBeInTheDocument();
  });
});
