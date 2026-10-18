import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HolidayCalendarsPage from "../HolidayCalendarsPage";
import { BASE, PATTERN, renderRoute } from "../../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const getHolidayCalendars = vi.fn();
const createHolidayCalendar = vi.fn();
const refreshHolidayCalendar = vi.fn();
const deleteHolidayCalendar = vi.fn();
const getHolidayEvents = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  getHolidayCalendars: (...a: unknown[]) => getHolidayCalendars(...a),
  createHolidayCalendar: (...a: unknown[]) => createHolidayCalendar(...a),
  refreshHolidayCalendar: (...a: unknown[]) => refreshHolidayCalendar(...a),
  deleteHolidayCalendar: (...a: unknown[]) => deleteHolidayCalendar(...a),
  getHolidayEvents: (...a: unknown[]) => getHolidayEvents(...a),
}));

const de = {
  id: "h1",
  name: "Feiertage Deutschland",
  url: "https://feiertage.example/de.ics",
  lastFetchedAt: "2026-10-01T04:12:00+00:00",
  eventCount: 16,
};
const ferien = {
  id: "h2",
  name: "Schulferien",
  url: "https://x.example/f.ics",
  lastFetchedAt: null,
  eventCount: 0,
};

let calendar: Record<string, unknown>;
let holidays: unknown[];

const route = `${PATTERN}/settings/holiday-calendars`;
const url = `${BASE}/settings/holiday-calendars`;

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: "Europe/Berlin" };
  holidays = [de, ferien];
  for (const fn of [
    apiGet,
    getHolidayCalendars,
    createHolidayCalendar,
    refreshHolidayCalendar,
    deleteHolidayCalendar,
    getHolidayEvents,
  ])
    fn.mockReset();
  mockApiGet(apiGet, (path: string) =>
    path === "/api/clubs/c1/calendars/k1" ? Promise.resolve(calendar) : Promise.resolve([]),
  );
  getHolidayCalendars.mockImplementation(() => Promise.resolve(holidays));
  createHolidayCalendar.mockResolvedValue({ ...de, id: "h3", eventCount: 14 });
  refreshHolidayCalendar.mockResolvedValue(de);
  deleteHolidayCalendar.mockResolvedValue(undefined);
  getHolidayEvents.mockResolvedValue([
    {
      id: "e1",
      holidayCalendarId: "h1",
      name: "Tag der Deutschen Einheit",
      date: "2026-10-03",
      dateEnd: null,
    },
    { id: "e2", holidayCalendarId: "h2", name: "Herbstferien", date: "2026-10-26", dateEnd: null },
  ]);
});

describe("HolidayCalendarsPage", () => {
  it("lists the holiday calendars with count and last fetch", async () => {
    renderRoute(route, url, <HolidayCalendarsPage />);
    const list = await screen.findByRole("list", { name: "Eingebundene Kalender (2)" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Feiertage Deutschland");
    expect(first).toHaveTextContent("16 Einträge · zuletzt abgerufen 01.10.2026, 06:12");
    expect(second).toHaveTextContent("0 Einträge · noch nie abgerufen");
    expect(
      screen.getByRole("navigation", { name: "Einstellungen des Kalenders" }),
    ).toBeInTheDocument();
  });

  it("shows the holidays of a calendar on demand", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await user.click(await screen.findByText("Feiertage der nächsten 12 Monate anzeigen"));
    expect(
      await screen.findByText("Tag der Deutschen Einheit", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Herbstferien", { exact: false })).not.toBeInTheDocument();
  });

  it("validates the form and links the errors to the fields", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Hinzufügen und abrufen" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte einen Namen eingeben.");
    expect(alert).toHaveTextContent("Bitte eine ICS-Adresse eingeben.");
    await user.click(within(alert).getByRole("link", { name: "Bitte eine ICS-Adresse eingeben." }));
    expect(screen.getByLabelText(/^ICS-Adresse/)).toHaveFocus();
    await user.type(screen.getByLabelText(/^Name/), "Feiertage AT");
    await user.type(screen.getByLabelText(/^ICS-Adresse/), "keine-url");
    await user.click(screen.getByRole("button", { name: "Hinzufügen und abrufen" }));
    expect(
      await screen.findByText("Bitte eine Adresse eingeben, die mit https:// beginnt.", {
        selector: "li a",
      }),
    ).toBeInTheDocument();
    expect(createHolidayCalendar).not.toHaveBeenCalled();
  });

  it("adds a calendar and clears the form", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), " Feiertage AT ");
    await user.type(screen.getByLabelText(/^ICS-Adresse/), "https://feiertage.example/at.ics");
    await user.click(screen.getByRole("button", { name: "Hinzufügen und abrufen" }));
    await waitFor(() =>
      expect(createHolidayCalendar).toHaveBeenCalledWith("k1", {
        name: "Feiertage AT",
        url: "https://feiertage.example/at.ics",
      }),
    );
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveValue(""));
  });

  it("explains an address that cannot be fetched", async () => {
    createHolidayCalendar.mockRejectedValue(
      Object.assign(new Error("Failed"), { status: 422, code: "ics_fetch_failed" }),
    );
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Feiertage AT");
    await user.type(screen.getByLabelText(/^ICS-Adresse/), "https://feiertage.example/at.ics");
    await user.click(screen.getByRole("button", { name: "Hinzufügen und abrufen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Adresse konnte nicht abgerufen werden. Prüfe die URL und versuche es erneut.",
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Feiertage AT");
  });

  it("explains an address the server rejects (validation_failed on url) like a failed fetch", async () => {
    createHolidayCalendar.mockRejectedValue(
      Object.assign(new Error("url: no TLD"), {
        status: 422,
        code: "validation_failed",
        field: "url",
      }),
    );
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Feiertage AT");
    await user.type(screen.getByLabelText(/^ICS-Adresse/), "https://127.0.0.1/at.ics");
    await user.click(screen.getByRole("button", { name: "Hinzufügen und abrufen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Adresse konnte nicht abgerufen werden. Prüfe die URL und versuche es erneut.",
    );
  });

  it("tells other rejections apart from a failed fetch by the code, not the status", async () => {
    createHolidayCalendar.mockRejectedValue(
      Object.assign(new Error("name: too long"), {
        status: 422,
        code: "validation_failed",
        field: "name",
      }),
    );
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Feiertage AT");
    await user.type(screen.getByLabelText(/^ICS-Adresse/), "https://feiertage.example/at.ics");
    await user.click(screen.getByRole("button", { name: "Hinzufügen und abrufen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Feiertagskalender konnte nicht hinzugefügt werden. Bitte versuche es erneut.",
    );
  });

  it("refreshes a calendar, with a busy state", async () => {
    let finish: (v: unknown) => void = () => undefined;
    refreshHolidayCalendar.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await user.click(
      await screen.findByRole("button", { name: "Feiertage Deutschland jetzt aktualisieren" }),
    );
    const busyRow = (await screen.findAllByRole("listitem"))[0];
    expect(busyRow).toHaveAttribute("aria-busy", "true");
    expect(
      within(busyRow).getByRole("button", { name: "Feiertage Deutschland wird aktualisiert" }),
    ).toBeInTheDocument();
    expect(busyRow).toHaveTextContent("Wird aktualisiert …");
    finish(de);
    await waitFor(() => expect(busyRow).not.toHaveAttribute("aria-busy"));
    expect(refreshHolidayCalendar).toHaveBeenCalledWith("k1", "h1");
  });

  it("reports a failed refresh at the row", async () => {
    refreshHolidayCalendar.mockRejectedValue(new Error("x"));
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await user.click(
      await screen.findByRole("button", { name: "Feiertage Deutschland jetzt aktualisieren" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Aktualisierung hat nicht geklappt.",
    );
  });

  it("deletes after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await user.click(await screen.findByRole("button", { name: "Schulferien löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Feiertagskalender „Schulferien“ löschen?",
    });
    expect(dialog).toHaveTextContent(
      "Die Feiertage verschwinden aus dem Kalender und lassen sich in Serien nicht mehr aussparen. Die Quelle im Internet bleibt unverändert.",
    );
    expect(deleteHolidayCalendar).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Feiertagskalender löschen" }));
    await waitFor(() => expect(deleteHolidayCalendar).toHaveBeenCalledWith("k1", "h2"));
  });

  it("names the number of holidays in the delete consequence", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <HolidayCalendarsPage />);
    await user.click(await screen.findByRole("button", { name: "Feiertage Deutschland löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Feiertagskalender „Feiertage Deutschland“ löschen?",
    });
    expect(dialog).toHaveTextContent(
      "Die 16 Feiertage verschwinden aus dem Kalender und lassen sich in Serien nicht mehr aussparen. Die Quelle im Internet bleibt unverändert.",
    );
  });

  it("shows the empty state", async () => {
    holidays = [];
    renderRoute(route, url, <HolidayCalendarsPage />);
    expect(
      await screen.findByRole("heading", { name: "Noch keine Feiertagskalender" }),
    ).toBeInTheDocument();
  });

  it("shows an error with retry when loading fails", async () => {
    getHolidayCalendars.mockRejectedValue(new Error("API error 500"));
    renderRoute(route, url, <HolidayCalendarsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Feiertagskalender konnten nicht geladen werden.",
    );
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderRoute(route, url, <HolidayCalendarsPage />);
    await screen.findByRole("list", { name: /Eingebundene Kalender/ });
    expect(screen.getByRole("status")).toHaveTextContent("Archiviert, schreibgeschützt");
    expect(screen.getByRole("button", { name: "Archivierung aufheben" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^ICS-Adresse/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /löschen|aktualisieren/ })).not.toBeInTheDocument();
  });
});
