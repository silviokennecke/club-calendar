import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventTemplatePickModal from "../EventTemplatePickModal";
import EventFromTemplateModal from "../EventFromTemplateModal";
import EventsExportPage from "../EventsExportPage";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";
import { ApiError } from "@/lib/api";
import type { SeriesRule } from "@/lib/events";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const download = vi.fn();
const apiFetch = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock("@/lib/events/ics", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/ics")>()),
  downloadBlob: (...a: unknown[]) => download(...a),
}));

const templates = [
  {
    id: "t1",
    calendarId: "k1",
    name: "Training Luftgewehr",
    timezone: "Europe/Berlin",
    timeBegin: "19:00:00",
    timeEnd: "21:00",
    locationId: "l1",
    location: { id: "l1", clubId: "k1", name: "Schützenhaus Waldblick" },
    properties: [],
    features: [],
    targetGroups: [],
  },
  {
    id: "t2",
    calendarId: "k1",
    name: "Jugendtraining",
    timezone: "Europe/Berlin",
    timeBegin: "18:00",
    timeEnd: "19:30",
    locationId: null,
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
  },
];

const events = [
  makeEvent({
    id: "1",
    name: "Training",
    date: "2026-10-01",
    targetGroups: [{ targetGroup: groups[1] }],
  }),
  makeEvent({
    id: "2",
    name: "Jugend",
    date: "2026-10-05",
    targetGroups: [{ targetGroup: groups[0] }],
  }),
  makeEvent({ id: "3", name: "Vorstand", date: "2026-10-07", isDraft: true }),
  makeEvent({ id: "4", name: "Fest", date: "2026-11-24" }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0));
  for (const fn of [apiGet, apiPost, download, apiFetch]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1")
      return Promise.resolve({
        id: "k1",
        clubId: "c1",
        name: "Schießbetrieb 2026",
        timezone: "Europe/Berlin",
      });
    if (path.endsWith("/templates")) return Promise.resolve(templates);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path === "/api/calendars/k1/events") return Promise.resolve(events);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue([]);
});

/** Stand-in for `POST …/events/series/preview` (the backend computes the dates). */
function fakeSeriesPreview(path: string, body: { rule: SeriesRule }) {
  if (path === "/api/calendars/k1/events/series")
    return Promise.resolve({ series: { id: "s1" }, events: [{ id: "e1" }] });
  if (path !== "/api/calendars/k1/events/series/preview") return Promise.resolve([]);
  const { rule } = body;
  const reformation = { date: "2026-10-31", name: "Reformationstag" };
  if (rule.until === "2026-10-06") {
    return Promise.resolve({ dates: [], count: 0, skippedHolidays: [], holidays: [] });
  }
  if (rule.frequency === "monthly") {
    const dates = rule.skipHolidays ? [] : ["2026-10-31"];
    return Promise.resolve({
      dates,
      count: dates.length,
      skippedHolidays: rule.skipHolidays ? [reformation] : [],
      holidays: [reformation],
    });
  }
  const saturdays = ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"];
  const dates = rule.skipHolidays ? saturdays.slice(0, 4) : saturdays;
  return Promise.resolve({
    dates,
    count: dates.length,
    skippedHolidays: rule.skipHolidays ? [reformation] : [],
    holidays: [reformation],
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("template picker", () => {
  it("lists templates as radio options and continues with the chosen one", async () => {
    const user = userEvent.setup();
    renderRoute(
      `${PATTERN}/events/new/template`,
      `${BASE}/events/new/template`,
      <EventTemplatePickModal />,
    );
    const group = await screen.findByRole("group", { name: "Vorlage" });
    const first = within(group).getByRole("radio", { name: /Training Luftgewehr/ });
    expect(first).toBeChecked();
    expect(group).toHaveTextContent("19:00 – 21:00 · Schützenhaus Waldblick");
    await user.click(within(group).getByRole("radio", { name: /Jugendtraining/ }));
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${BASE}/events/new/template/t2`,
    );
  });
  it("filters the templates by name while typing", async () => {
    const user = userEvent.setup();
    renderRoute(
      `${PATTERN}/events/new/template`,
      `${BASE}/events/new/template`,
      <EventTemplatePickModal />,
    );
    await user.type(
      await screen.findByRole("searchbox", { name: "Vorlagen nach Namen suchen" }),
      "jugend",
    );
    const group = screen.getByRole("group", { name: "Vorlage" });
    expect(within(group).queryByRole("radio", { name: /Training Luftgewehr/ })).toBeNull();
    expect(within(group).getByRole("radio", { name: /Jugendtraining/ })).toBeChecked();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByRole("status")).toHaveTextContent("Keine Vorlage zu „zzz“ gefunden.");
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
  });
  it("cancels back to the page it was opened from", async () => {
    const user = userEvent.setup();
    renderRoute(
      `${PATTERN}/events/new/template`,
      `${BASE}/events/new/template?date=2026-10-14`,
      <EventTemplatePickModal />,
    );
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}?date=2026-10-14`);
  });
});

describe("event from template", () => {
  function renderSeries(query = "") {
    return renderRoute(
      `${PATTERN}/events/new/template/:templateId`,
      `${BASE}/events/new/template/t1${query}`,
      <EventFromTemplateModal />,
    );
  }

  it("closes the template dialog directly while nothing was changed", async () => {
    const user = userEvent.setup();
    renderSeries("?date=2026-10-15");
    expect(await screen.findByText("Training Luftgewehr")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Schließen, nichts anlegen" }));
    expect(await screen.findByTestId("location")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before closing the template dialog with changes", async () => {
    const user = userEvent.setup();
    renderSeries("?date=2026-10-15");
    await screen.findByText("Training Luftgewehr");
    await user.click(screen.getByRole("button", { name: "Veröffentlicht" }));
    await user.click(screen.getByRole("button", { name: "Schließen, nichts anlegen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Änderungen verwerfen?");
    await user.click(within(dialog).getByRole("button", { name: "Weiter bearbeiten" }));
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("creates a single event from the template", async () => {
    const user = userEvent.setup();
    renderSeries("?date=2026-10-15");
    expect(await screen.findByText("Training Luftgewehr")).toBeVisible();
    expect(screen.getByLabelText(/^Datum/)).toHaveValue("2026-10-15");
    expect(screen.getByText("1 Termin wird angelegt.")).toBeVisible();
    expect(screen.getByText("Do 15.10.2026")).toBeVisible();
    // Shown for the chosen template and for the preview row (design: EventSeries).
    expect(screen.getAllByText("19:00–21:00 Uhr · Schützenhaus Waldblick")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Vorher anpassen" })).toHaveAttribute(
      "href",
      `${BASE}/events/new/form?templateId=t1&date=2026-10-15`,
    );
    await user.click(screen.getByRole("button", { name: "Veröffentlicht" }));
    await user.click(screen.getByRole("button", { name: "1 Termin anlegen und veröffentlichen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/events/from-template", {
        templateId: "t1",
        dates: ["2026-10-15"],
        overrides: { isDraft: false },
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(BASE);
  });

  it("previews a series from the backend and creates it", async () => {
    const user = userEvent.setup();
    apiPost.mockImplementation(fakeSeriesPreview);
    renderSeries("?date=2026-10-03");
    await user.click(await screen.findByRole("button", { name: "Terminserie" }));
    await user.selectOptions(screen.getByLabelText("Wochentag"), "6");
    await user.clear(screen.getByLabelText(/^Bis/));
    await user.type(screen.getByLabelText(/^Bis/), "2026-10-31");
    expect(
      await screen.findByText("4 Termine werden angelegt. 1 Feiertag wird ausgelassen."),
    ).toBeVisible();
    expect(screen.getByText("wird ausgelassen")).toBeVisible();
    expect(screen.getByText("1 Tag ausgenommen")).toBeVisible();
    await waitFor(() =>
      expect(apiPost).toHaveBeenLastCalledWith("/api/calendars/k1/events/series/preview", {
        rule: {
          frequency: "weekly",
          weekday: 6,
          nth: null,
          startDate: "2026-10-03",
          until: "2026-10-31",
          count: null,
          skipHolidays: true,
        },
      }),
    );
    expect(screen.queryByText("Bald verfügbar")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /Feiertage auslassen/ }));
    expect(await screen.findByText("5 Termine werden angelegt.")).toBeVisible();
    expect(screen.getByText("liegt auf Reformationstag")).toBeVisible();
    expect(screen.getByText("1 Feiertag bleibt in der Serie")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Monatlich am n-ten Wochentag" }));
    await user.click(screen.getByRole("button", { name: "Letzter" }));
    expect(await screen.findByText("1 Termin wird angelegt.")).toBeVisible();

    const create = await screen.findByRole("button", { name: "1 Termin als Entwurf anlegen" });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/events/series", {
        rule: {
          frequency: "monthly",
          weekday: 6,
          nth: 5,
          startDate: "2026-10-03",
          until: "2026-10-31",
          count: null,
          skipHolidays: false,
        },
        templateId: "t1",
        isDraft: true,
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(BASE);
  });

  it("warns when no day matches", async () => {
    const user = userEvent.setup();
    apiPost.mockImplementation(fakeSeriesPreview);
    renderSeries("?date=2026-10-05");
    await user.click(await screen.findByRole("button", { name: "Terminserie" }));
    await user.clear(screen.getByLabelText(/^Bis/));
    await user.type(screen.getByLabelText(/^Bis/), "2026-10-06");
    await user.selectOptions(screen.getByLabelText("Wochentag"), "5");
    expect(
      await screen.findByText(
        "Im gewählten Zeitraum gibt es keine passenden Tage. Ändere den Wochentag oder den Zeitraum.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Es entstehen keine Termine.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Keine Termine zum Anlegen" })).toBeDisabled();
  });

  it("blocks the series above the limit and when the preview fails", async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(new ApiError("too many", 422, "too_many_events"));
    renderSeries("?date=2026-10-05");
    await user.click(await screen.findByRole("button", { name: "Terminserie" }));
    expect(
      await screen.findByText("Eine Serie hat höchstens 366 Termine. Verkürze den Zeitraum."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Keine Termine zum Anlegen" })).toBeDisabled();

    apiPost.mockRejectedValue(new ApiError("boom", 500));
    await user.click(screen.getByRole("button", { name: "Zweiwöchentlich" }));
    expect(await screen.findByText("Die Vorschau konnte nicht geladen werden.")).toBeVisible();
    apiPost.mockImplementation(fakeSeriesPreview);
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText(/Termine werden angelegt/)).toBeVisible();
  });

  it("shows when the end is before the start and sends nothing", async () => {
    const user = userEvent.setup();
    apiPost.mockImplementation(fakeSeriesPreview);
    renderSeries("?date=2026-10-05");
    await user.click(await screen.findByRole("button", { name: "Terminserie" }));
    await user.clear(screen.getByLabelText(/^Bis/));
    await user.type(screen.getByLabelText(/^Bis/), "2026-10-01");
    expect(await screen.findByText("Das Ende liegt vor dem Anfang.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Keine Termine zum Anlegen" })).toBeDisabled();
  });
});

describe("export", () => {
  function renderExport() {
    return renderRoute(`${PATTERN}/events/export`, `${BASE}/events/export`, <EventsExportPage />);
  }

  it("counts what gets exported and downloads an ICS file", async () => {
    const user = userEvent.setup();
    renderExport();
    expect(await screen.findByText("3 Termine werden exportiert")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Dieser Monat/ }));
    expect(screen.getByText("2 Termine werden exportiert")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Auch Entwürfe/ }));
    expect(screen.getByText("3 Termine werden exportiert")).toBeVisible();
    expect(
      screen.getByText(
        "Entwürfe stehen dann in deiner Datei. In Feeds bleiben sie weiterhin ausgeschlossen.",
      ),
    ).toBeVisible();
    await user.click(
      within(screen.getByRole("group", { name: "Gruppen filtern" })).getByRole("button", {
        name: "Jugend",
      }),
    );
    expect(screen.getByText("1 Termin wird exportiert")).toBeVisible();

    apiFetch.mockResolvedValue(new Response("BEGIN:VCALENDAR", { status: 200 }));
    await user.click(screen.getByRole("button", { name: "ICS-Datei laden" }));
    // The backend builds the file (same filters as the preview), downloaded with the JWT
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [url] = apiFetch.mock.calls[0] as [string];
    const [path, query] = url.split("?");
    expect(path).toBe("/api/calendars/k1/events.ics");
    const params = new URLSearchParams(query);
    expect(params.get("from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(params.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.get("includeDrafts")).toBe("1");
    expect(params.getAll("targetGroupIds[]")).toEqual([
      groups.find((g) => g.name === "Jugend")!.id,
    ]);
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(name).toBe("schiessbetrieb-2026.ics");
    expect(await blob.text()).toBe("BEGIN:VCALENDAR");
  });

  it("shows an error when the file cannot be created", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(new Response("{}", { status: 500 }));
    renderExport();
    await screen.findByText("3 Termine werden exportiert");
    await user.click(screen.getByRole("button", { name: "ICS-Datei laden" }));
    expect(await screen.findByText("Die Datei konnte nicht erstellt werden")).toBeVisible();
    expect(download).not.toHaveBeenCalled();
    // The whole calendar without filters: no query
    expect(apiFetch.mock.calls[0][0]).toBe("/api/calendars/k1/events.ics");
  });

  it("disables the download when nothing matches", async () => {
    const user = userEvent.setup();
    renderExport();
    await screen.findByText("3 Termine werden exportiert");
    await user.click(screen.getByRole("radio", { name: /Von – bis/ }));
    await user.clear(screen.getByLabelText("Von"));
    await user.type(screen.getByLabelText("Von"), "2027-01-01");
    await user.clear(screen.getByLabelText("Bis"));
    await user.type(screen.getByLabelText("Bis"), "2027-01-31");
    expect(screen.getByText("Keine Termine werden exportiert")).toBeVisible();
    expect(screen.getByRole("button", { name: "ICS-Datei laden" })).toBeDisabled();
  });
});
