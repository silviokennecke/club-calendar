import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, useLocation } from "react-router-dom";
import CalendarPage from "../CalendarPage";
import { BackgroundRoutes } from "@/components/layout/BackgroundRoutes";
import { Modal, ModalFrame } from "@/components/ui/shared";
import { useModalNav } from "@/lib/useModalNav";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const getHolidayEvents = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: vi.fn(),
  getHolidayEvents: (...a: unknown[]) => getHolidayEvents(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", firstDayOfWeek: 1 } }),
}));

const groups = [
  { id: "tg-j", calendarid: "k1", name: "Jugend" },
  { id: "tg-e", calendarid: "k1", name: "Erwachsene" },
];

function event(partial: Record<string, unknown>) {
  return {
    calendarId: "k1",
    timeBegin: "19:00",
    timeEnd: "21:00",
    isAllDay: false,
    isDraft: false,
    timezone: null,
    locationId: null,
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
    dateEnd: null,
    ...partial,
  };
}

const october = [
  event({ id: "e1", name: "Training Luftgewehr", date: "2026-10-08" }),
  event({
    id: "e2",
    name: "Jugendtraining",
    date: "2026-10-08",
    timeBegin: "18:00",
    timeEnd: "19:30",
    targetGroups: [{ targetGroup: groups[0] }],
  }),
  event({ id: "e3", name: "Vorstandssitzung", date: "2026-10-07", isDraft: true }),
  event({
    id: "e4",
    name: "Vereinsmeisterschaft",
    date: "2026-10-10",
    dateEnd: "2026-10-11",
    isAllDay: true,
  }),
];

let calendar: Record<string, unknown> = { id: "k1", clubId: "c1", name: "Schießbetrieb" };
let events: unknown[] = october;
let extraHolidays: {
  id: string;
  holidayCalendarId: string;
  name: string;
  date: string;
  dateEnd: string | null;
}[] = [];
let failEvents = false;

function mockApi() {
  apiGet.mockImplementation((path: string) => {
    // The single GET carries the calendar's eventCount (empty-state check)
    if (path === "/api/clubs/c1/calendars/k1")
      return Promise.resolve({ ...calendar, eventCount: events.length });
    if (path === "/api/calendars/k1/target-groups") return Promise.resolve(groups);
    if (path.startsWith("/api/calendars/k1/events")) {
      if (failEvents) return Promise.reject(new Error("offline"));
      const url = new URL(path, "http://x");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const tg = url.searchParams.get("targetGroupIds");
      // Like the backend: overlap of [date, dateEnd] with [from, to]
      return Promise.resolve(
        (
          events as {
            date: string;
            dateEnd?: string | null;
            targetGroups: { targetGroup: { id: string } }[];
          }[]
        ).filter(
          (e) =>
            (!from || (e.dateEnd ?? e.date) >= from) &&
            (!to || e.date <= to) &&
            (!tg || e.targetGroups.some((g) => tg.split(",").includes(g.targetGroup.id))),
        ),
      );
    }
    return Promise.resolve([]);
  });
  getHolidayEvents.mockImplementation((_id: string, from: string, to: string) =>
    Promise.resolve(
      [
        {
          id: "h1",
          holidayCalendarId: "hc",
          name: "Tag der Deutschen Einheit",
          date: "2026-10-03",
          dateEnd: null,
        },
        ...extraHolidays,
      ].filter((h) => (h.dateEnd ?? h.date) >= from && h.date <= to),
    ),
  );
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

/** Stand-in for the event dialogs: shows its URL, closes like them. */
function ModalProbe() {
  const loc = useLocation();
  const nav = useModalNav();
  return (
    <Modal title="Termin-Dialog" closeLabel="Schließen" onClose={nav.close}>
      <p data-testid="modal-location">{loc.pathname + loc.search}</p>
    </Modal>
  );
}

function renderPage(path = "/clubs/c1/calendars/k1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <BackgroundRoutes
          pages={
            <>
              <Route
                path="/clubs/:clubId/calendars/:calendarId"
                element={
                  <>
                    <CalendarPage />
                    <Probe />
                  </>
                }
              />
              <Route path="*" element={<Probe />} />
            </>
          }
          modals={
            <Route element={<ModalFrame />}>
              <Route path="*" element={<ModalProbe />} />
            </Route>
          }
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Local noon: "today" is 2 October in every browser time zone (the calendar has none).
  vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0));
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb" };
  events = october;
  failEvents = false;
  extraHolidays = [];
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  getHolidayEvents.mockReset();
  mockApi();
});

afterEach(() => {
  vi.useRealTimers();
});

async function grid() {
  return screen.findByRole("grid", { name: "Oktober 2026" });
}

describe("CalendarPage – month view", () => {
  it("shows holidays that began before the visible range and reach into it", async () => {
    extraHolidays = [
      // Autumn break from mid September: starts before the grid (28 Sep), ends on 5 Oct.
      {
        id: "h2",
        holidayCalendarId: "hc",
        name: "Herbstferien",
        date: "2026-09-14",
        dateEnd: "2026-10-05",
      },
      // Ended long before the grid: must not show.
      {
        id: "h3",
        holidayCalendarId: "hc",
        name: "Sommerferien",
        date: "2026-08-10",
        dateEnd: "2026-08-25",
      },
    ];
    renderPage();
    const g = await grid();
    expect(
      await within(g).findByRole("button", { name: /5\. Oktober.*Feiertag Herbstferien/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sommerferien")).toBeNull();
    // The API filters by overlap: the request covers exactly the grid (no look-back).
    const [, from, to] = getHolidayEvents.mock.calls[0];
    expect([from, to]).toEqual(["2026-09-28", "2026-11-01"]);
    expect(apiGet).toHaveBeenCalledWith("/api/calendars/k1/events?from=2026-09-28&to=2026-11-01");
  });

  it("shows the current month with events, holidays and today", async () => {
    renderPage();
    const g = await grid();
    expect(screen.getByRole("heading", { level: 1, name: "Oktober 2026" })).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(
      within(g)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    const day8 = await within(g).findByRole("button", { name: "8. Oktober, 2 Termine" });
    expect(day8).toBeInTheDocument();
    expect(
      await within(g).findByRole("button", {
        name: "3. Oktober, Feiertag Tag der Deutschen Einheit",
      }),
    ).toBeInTheDocument();
    const today = within(g).getByRole("button", { name: /^2\. Oktober, heute/ });
    expect(today).toHaveAttribute("aria-current", "date");
    // Roving tabindex: only the active day (today) is in the tab order.
    expect(today).toHaveAttribute("tabindex", "0");
    expect(day8).toHaveAttribute("tabindex", "-1");
    // Draft shown as word, not only colour.
    expect(screen.getByTitle(/Vorstandssitzung.*\(Entwurf\)/)).toHaveTextContent("Entwurf");
    expect(screen.getByText("Entwurf, nur intern sichtbar")).toBeInTheDocument();
  });

  it("navigates months with previous / next / today and keeps the date in the URL", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await user.click(screen.getByRole("button", { name: "Nächster Monat" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "November 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("date=2026-11-02");
    await user.click(screen.getByRole("button", { name: "Vorheriger Monat" }));
    await user.click(screen.getByRole("button", { name: "Vorheriger Monat" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "September 2026" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Heute" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Oktober 2026" }),
    ).toBeInTheDocument();
  });

  it("opens a deep-linked month and clamps navigation to the month length", async () => {
    const user = userEvent.setup();
    renderPage("/clubs/c1/calendars/k1?date=2027-01-31");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Januar 2027" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nächster Monat" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Februar 2027" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("date=2027-02-28");
  });

  it("moves with the arrow keys, opens a day with Enter and closes it with Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    const g = await grid();
    await within(g).findByRole("button", { name: "8. Oktober, 2 Termine" });
    within(g)
      .getByRole("button", { name: /^2\. Oktober/ })
      .focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/^9\. Oktober/));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toHaveAccessibleName("8. Oktober, 2 Termine");
    expect(document.activeElement).toHaveAttribute("tabindex", "0");

    await user.keyboard("{Enter}");
    const panelHeading = await screen.findByRole("heading", {
      level: 2,
      name: "Donnerstag, 8. Oktober",
    });
    expect(panelHeading).toHaveFocus();
    const panel = panelHeading.closest("section")!;
    expect(within(panel).getByRole("button", { name: "Jugendtraining" })).toBeInTheDocument();
    expect(within(panel).getByText("18:00 bis 19:30 Uhr")).toBeInTheDocument();
    expect(within(panel).getAllByText("Veröffentlicht").length).toBeGreaterThan(0);
    expect(within(panel).getByText("Jugend")).toBeInTheDocument();
    expect(g.querySelector('[aria-selected="true"] [data-date="2026-10-08"]')).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { level: 2, name: "Donnerstag, 8. Oktober" })).toBeNull();
    expect(document.activeElement).toHaveAccessibleName("8. Oktober, 2 Termine");
  });

  it("changes the month when the arrow keys leave it", async () => {
    const user = userEvent.setup();
    renderPage("/clubs/c1/calendars/k1?date=2026-10-01");
    const g = await grid();
    within(g)
      .getByRole("button", { name: /^1\. Oktober/ })
      .focus();
    await user.keyboard("{ArrowLeft}");
    expect(
      await screen.findByRole("heading", { level: 1, name: "September 2026" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/^30\. September/));
    await user.keyboard("{PageDown}");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Oktober 2026" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/^30\. Oktober/));
  });

  it("shows an empty day and offers to create an event there", async () => {
    const user = userEvent.setup();
    renderPage();
    const g = await grid();
    await user.click(within(g).getByRole("button", { name: /^14\. Oktober/ }));
    expect(await screen.findByText("An diesem Tag gibt es keine Termine.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Termin an diesem Tag anlegen" }));
    // Straight to the form dialog with the day as start date (design: EventNewForm).
    expect(await screen.findByTestId("modal-location")).toHaveTextContent(
      "/clubs/c1/calendars/k1/events/new/form?date=2026-10-14",
    );
  });

  it("opens an event from its chip as a dialog above the calendar", async () => {
    const user = userEvent.setup();
    renderPage("/clubs/c1/calendars/k1?date=2026-10-08");
    const g = await grid();
    const chip = await screen.findByTitle(/^Training Luftgewehr/);
    await user.click(chip);
    expect(await screen.findByTestId("modal-location")).toHaveTextContent(
      "/clubs/c1/calendars/k1/events/e1",
    );
    // The calendar stays (same month), inert and hidden from screen readers.
    expect(screen.getByRole("dialog", { name: "Termin-Dialog" })).toBeVisible();
    expect(g).toBeInTheDocument();
    expect(g.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/clubs/c1/calendars/k1?date=2026-10-08",
    );
    // Closing (history back) returns to the calendar, focus to the chip.
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(g.closest("[inert]")).toBeNull();
    await waitFor(() => expect(chip).toHaveFocus());
  });

  it("closes the dialog with Escape back to the calendar", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await user.click(screen.getByRole("button", { name: "Termin anlegen" }));
    await screen.findByRole("dialog", { name: "Termin-Dialog" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/clubs\/c1\/calendars\/k1$/);
    expect(screen.getByRole("button", { name: "Termin anlegen" })).toHaveFocus();
  });

  it("opens the create choice from the split button", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await user.click(screen.getByRole("button", { name: "Termin anlegen" }));
    expect(await screen.findByTestId("modal-location")).toHaveTextContent(
      /^\/clubs\/c1\/calendars\/k1\/events\/new$/,
    );
  });
});

describe("CalendarPage – filters and search", () => {
  it("filters by target group (aria-pressed) and resets", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await screen.findByTitle(/^Training Luftgewehr/);
    const group = screen.getByRole("group", { name: "Nach Gruppe filtern" });
    const chip = within(group).getByRole("button", { name: "Jugend" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(expect.stringContaining("targetGroupIds=tg-j")),
    );
    await waitFor(() => expect(screen.queryByTitle(/^Training Luftgewehr/)).toBeNull());
    expect(screen.getByTitle(/^Jugendtraining/)).toBeInTheDocument();
    // Holidays are hidden while filtering.
    expect(screen.queryByTitle(/Tag der Deutschen Einheit/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByTitle(/^Training Luftgewehr/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter zurücksetzen" })).toBeNull();
  });

  it("searches by name and explains when nothing matches", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await screen.findByTitle(/^Training Luftgewehr/);
    const input = screen.getByLabelText("Termine suchen");
    await user.type(input, "meister");
    expect(screen.getByTitle(/^Vereinsmeisterschaft/)).toBeInTheDocument();
    expect(screen.queryByTitle(/^Training Luftgewehr/)).toBeNull();

    await user.clear(input);
    await user.type(input, "Sommerfest");
    expect(
      screen.getByRole("heading", { name: "Keine Termine zu „Sommerfest“ gefunden" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Suche zurücksetzen" }));
    expect(input).toHaveValue("");
    expect(await grid()).toBeInTheDocument();
  });
});

describe("CalendarPage – week view", () => {
  it("shows the week with columns and switches via links", async () => {
    const user = userEvent.setup();
    renderPage("/clubs/c1/calendars/k1?view=week&date=2026-10-08");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /^KW 41 · 05\.\s?[–-]\s?11\.10\.2026$/,
      }),
    ).toBeInTheDocument();
    const thursday = await screen.findByRole("region", { name: "Do 08.10." });
    expect(
      await within(thursday).findByRole("button", { name: /Training Luftgewehr/ }),
    ).toBeInTheDocument();
    const monday = screen.getByRole("region", { name: "Mo 05.10." });
    expect(within(monday).getByText("Keine Termine")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Woche" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Nächste Woche" }));
    expect(await screen.findByRole("heading", { level: 1, name: /^KW 42/ })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Monat" }));
    expect(await screen.findByRole("grid", { name: "Oktober 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Liste" })).toHaveAttribute(
      "href",
      "/clubs/c1/calendars/k1/events",
    );
  });
});

describe("CalendarPage – create menu", () => {
  it("offers template and import in the split button menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    const toggle = screen.getByRole("button", { name: "Weitere Wege, Termine anzulegen" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Termine importieren" })).toHaveAttribute(
      "href",
      "/clubs/c1/calendars/k1/import",
    );
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Aus Vorlage" }));
    expect(await screen.findByTestId("modal-location")).toHaveTextContent(
      "/clubs/c1/calendars/k1/events/new/template",
    );
  });
});

describe("CalendarPage – archived calendar", () => {
  beforeEach(() => {
    calendar = { id: "k1", clubId: "c1", name: "Saison 2025", archivedAt: "2026-01-10T00:00:00Z" };
  });

  it("is read-only and can be unarchived", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText("Archiviert, schreibgeschützt")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dieser Kalender ist archiviert und schreibgeschützt. Termine lassen sich nicht ändern.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Termin anlegen" })).toBeNull();
    expect(screen.queryByText(/auf einen anderen Tag ziehen/)).toBeNull();

    // Days open without a create action; events open read-only.
    const g = await grid();
    await user.click(within(g).getByRole("button", { name: /^14\. Oktober/ }));
    expect(await screen.findByText("An diesem Tag gibt es keine Termine.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Termin an diesem Tag anlegen" })).toBeNull();
    // Archived calendars can still be exported (design: CalendarArchived).
    expect(screen.getByRole("link", { name: "Termine exportieren" })).toHaveAttribute(
      "href",
      "/clubs/c1/calendars/k1/events/export",
    );

    calendar = { id: "k1", clubId: "c1", name: "Saison 2025", archivedAt: null };
    await user.click(screen.getByRole("button", { name: "Archivierung aufheben" }));
    expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/calendars/k1/unarchive", {});
    expect(
      await screen.findByText("Kalender ist wieder aktiv. Du kannst Termine bearbeiten."),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Termin anlegen" })).toBeInTheDocument();
  });
});

describe("CalendarPage – states", () => {
  it("shows the empty state for a calendar without events", async () => {
    events = [];
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Noch keine Termine in diesem Kalender" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Termine importieren" })).toBeInTheDocument();
    // The calendar's eventCount answers it, no full event list is loaded
    expect(apiGet).not.toHaveBeenCalledWith("/api/calendars/k1/events");
  });

  it("does not claim the calendar is empty when only the month is", async () => {
    events = [event({ id: "x", name: "Später", date: "2027-03-01" })];
    renderPage();
    const g = await grid();
    expect(g).toBeInTheDocument();
    await waitFor(() =>
      expect(
        apiGet.mock.calls.filter(([p]) => p === "/api/clubs/c1/calendars/k1").length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(
      screen.queryByRole("heading", { name: "Noch keine Termine in diesem Kalender" }),
    ).toBeNull();
  });

  it("shows a loading placeholder, then an error with retry", async () => {
    const user = userEvent.setup();
    failEvents = true;
    renderPage();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Kalender wird geladen");
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Kalender wurde nicht geladen");
    expect(screen.queryByRole("grid")).toBeNull();
    failEvents = false;
    await user.click(screen.getByRole("button", { name: "Erneut laden" }));
    expect(await grid()).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("CalendarPage – moving events", () => {
  it("moves a multi-day event by drag and drop and keeps its length", async () => {
    apiPatch.mockResolvedValue({});
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 700,
      height: 100,
      right: 700,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    try {
      renderPage();
      const g = await grid();
      const chip = await screen.findByTitle(/^Vereinsmeisterschaft/);
      expect(chip).toHaveAttribute("draggable", "true");
      const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
      fireEvent.dragStart(chip, { dataTransfer });
      const body = within(g)
        .getByRole("button", { name: /^17\. Oktober/ })
        .closest(".ap-wk-body")!;
      // Saturday = 6th column (index 5) of 7 columns, 100px each. jsdom has no DragEvent,
      // so clientX is set on the created event.
      for (const type of ["dragOver", "drop"] as const) {
        const ev = createEvent[type](body, { dataTransfer });
        Object.defineProperty(ev, "clientX", { value: 550 });
        fireEvent(body, ev);
      }
      await waitFor(() =>
        expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/events/e4", {
          date: "2026-10-17",
          dateEnd: "2026-10-18",
        }),
      );
    } finally {
      rect.mockRestore();
    }
  });
});

describe("CalendarPage – phone width", () => {
  it("shows the compact grid with the selected day's events and a create button", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 720px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const user = userEvent.setup();
      renderPage("/clubs/c1/calendars/k1?view=week");
      // Phones always use the month grid (the view switch is desktop only).
      const g = await grid();
      expect(g).toHaveClass("cc-grid");
      expect(
        screen.getByRole("heading", { level: 2, name: "Freitag, 2. Oktober" }),
      ).toBeInTheDocument();
      expect(screen.getByText("An diesem Tag gibt es keine Termine.")).toBeInTheDocument();
      await user.click(await within(g).findByRole("button", { name: "8. Oktober, 2 Termine" }));
      expect(
        screen.getByRole("heading", { level: 2, name: "Donnerstag, 8. Oktober" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Training Luftgewehr" })).toBeInTheDocument();
      expect(within(g).getByRole("button", { name: "8. Oktober, 2 Termine" })).toHaveClass(
        "cc-day--selected",
      );
      const fab = screen
        .getAllByRole("button", { name: "Termin anlegen" })
        .find((b) => b.classList.contains("ap-fab"));
      expect(fab).toBeDefined();
      await user.click(fab!);
      expect(await screen.findByTestId("modal-location")).toHaveTextContent(
        "/clubs/c1/calendars/k1/events/new?date=2026-10-08",
      );
    } finally {
      window.matchMedia = original;
    }
  });
});
