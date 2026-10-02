import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import CalendarPage from "../CalendarPage";

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

let calendar: Record<string, unknown> = { id: "k1", clubid: "c1", name: "Schießbetrieb" };
let events: unknown[] = october;
let failEvents = false;

function mockApi() {
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path === "/api/calendars/k1/target-groups") return Promise.resolve(groups);
    if (path.startsWith("/api/calendars/k1/events")) {
      if (failEvents) return Promise.reject(new Error("offline"));
      const url = new URL(path, "http://x");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const tg = url.searchParams.get("targetGroupIds");
      return Promise.resolve(
        (events as { date: string; targetGroups: { targetGroup: { id: string } }[] }[]).filter(
          (e) =>
            (!from || e.date >= from) &&
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
      ].filter((h) => h.date >= from && h.date <= to),
    ),
  );
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(path = "/clubs/c1/calendars/k1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Local noon: "today" is 2 October in every browser time zone (the calendar has none).
  vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0));
  calendar = { id: "k1", clubid: "c1", name: "Schießbetrieb" };
  events = october;
  failEvents = false;
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
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Neuer Termin" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Startdatum *")).toHaveValue("2026-10-14");
  });

  it("opens an event from its chip", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await user.click(await screen.findByTitle(/^Training Luftgewehr/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Termin bearbeiten" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name *")).toHaveValue("Training Luftgewehr");
    expect(within(dialog).getByRole("button", { name: "Löschen" })).toBeInTheDocument();
  });
});

describe("CalendarPage – filters and search", () => {
  it("filters by target group (aria-pressed) and resets", async () => {
    const user = userEvent.setup();
    renderPage();
    await grid();
    await screen.findByTitle(/^Training Luftgewehr/);
    const group = screen.getByRole("group", { name: "Nach Zielgruppe filtern" });
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
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Aus Vorlage" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("CalendarPage – archived calendar", () => {
  beforeEach(() => {
    calendar = { id: "k1", clubid: "c1", name: "Saison 2025", archivedAt: "2026-01-10T00:00:00Z" };
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
    await user.click(await screen.findByTitle(/^Training Luftgewehr/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Termin ansehen" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name *")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Löschen" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Speichern" })).toBeNull();
    await user.click(within(dialog).getAllByRole("button", { name: "Schließen" })[0]);

    calendar = { id: "k1", clubid: "c1", name: "Saison 2025", archivedAt: null };
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
    expect(apiGet).toHaveBeenCalledWith("/api/calendars/k1/events");
  });

  it("does not claim the calendar is empty when only the month is", async () => {
    events = [event({ id: "x", name: "Später", date: "2027-03-01" })];
    renderPage();
    const g = await grid();
    expect(g).toBeInTheDocument();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/calendars/k1/events"));
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
      expect(within(await screen.findByRole("dialog")).getByLabelText("Startdatum *")).toHaveValue(
        "2026-10-08",
      );
    } finally {
      window.matchMedia = original;
    }
  });
});
