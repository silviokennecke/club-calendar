import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import EventFormModal from "../EventFormModal";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

const locations = [
  {
    id: "l1",
    clubId: "k1",
    name: "Schützenhaus Waldblick",
    street: "Waldstraße 12",
    zip: "12345",
    city: "Musterstadt",
    latitude: 51.1,
    longitude: 7.1,
  },
];
const properties = [{ id: "p1", calendarid: "k1", name: "Wettkampf", icon: "🏆" }];
const features = [{ id: "f1", calendarid: "k1", name: "Bonusschießen" }];
const template = {
  id: "t1",
  calendarId: "k1",
  name: "Training Luftgewehr",
  timezone: "Europe/Berlin",
  timeBegin: "19:00",
  timeEnd: "21:00",
  locationId: "l1",
  location: locations[0],
  properties: [],
  features: [{ feature: features[0] }],
  targetGroups: [{ targetGroup: groups[1] }],
};
const existing = makeEvent({
  id: "e1",
  name: "Herbstfest",
  date: "2026-10-24",
  timeBegin: "15:00",
  timeEnd: "22:00",
  targetGroups: [{ targetGroup: groups[0] }],
});

let calendar: Record<string, unknown>;

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026" };
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path.endsWith("/locations")) return Promise.resolve(locations);
    if (path.endsWith("/properties")) return Promise.resolve(properties);
    if (path.endsWith("/features")) return Promise.resolve(features);
    if (path.endsWith("/templates")) return Promise.resolve([template]);
    if (path === "/api/calendars/k1/events/e1") return Promise.resolve(existing);
    if (path === "/api/calendars/k1/events/gone")
      return Promise.reject(new ApiError("Event not found", 404));
    if (path === "/api/calendars/k1/events/foreign")
      return Promise.reject(new ApiError("Access denied", 403));
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({ id: "new" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

const newRoute = `${PATTERN}/events/new/form`;
const editRoute = `${PATTERN}/events/:eventId`;

function renderNew(query = "", state?: unknown) {
  return renderRoute(newRoute, `${BASE}/events/new/form${query}`, <EventFormModal />, state);
}
function renderEdit(id = "e1", state?: unknown) {
  return renderRoute(editRoute, `${BASE}/events/${id}`, <EventFormModal />, state);
}

describe("EventFormModal – new event", () => {
  it("opens as a form dialog and starts in the first field", async () => {
    renderNew("?date=2026-10-14");
    const name = await screen.findByLabelText(/^Name/);
    const dialog = screen.getByRole("dialog", { name: "Neuer Termin" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("ap-dialog--xl", "ap-dialog--form");
    expect(dialog).toHaveAccessibleDescription("Der neue Termin ist zunächst ein Entwurf.");
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("shows no error on open, even if the dialog briefly takes the focus; validates after the user leaves the field", async () => {
    const user = userEvent.setup();
    renderNew();
    const name = await screen.findByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveFocus());
    act(() => name.blur());
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Bitte gib einen Namen ein.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(name);
    await user.tab();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("Bitte gib einen Namen ein.").length).toBeGreaterThan(0);
  });

  it("suggests templates for the name and applies them with Enter without submitting", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14");
    const name = await screen.findByLabelText(/^Name/);
    await user.type(name, "Trai");
    const option = await screen.findByRole("option", { name: /Training Luftgewehr/ });
    expect(option).toHaveTextContent("19:00");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(name).toHaveValue("Training Luftgewehr");
    expect(screen.queryByRole("option", { name: /Training/ })).toBeNull();
    expect(screen.getByLabelText(/^Startdatum/)).toHaveValue("2026-10-14");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("does not suggest templates when editing", async () => {
    const user = userEvent.setup();
    renderEdit();
    const name = await screen.findByLabelText(/^Name/);
    await user.type(name, "Trai");
    expect(screen.queryByRole("option", { name: /Training/ })).toBeNull();
  });

  it("asks before Escape discards changes", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14", { background: `${BASE}?date=2026-10-14` });
    await user.type(await screen.findByLabelText(/^Name/), "Entwurf");
    await user.keyboard("{Escape}");
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Änderungen verwerfen?");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Entwurf");

    await user.keyboard("{Escape}");
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Änderungen verwerfen",
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}?date=2026-10-14`);
  });

  it("goes one step back to the choice and keeps the date", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14");
    await screen.findByLabelText(/^Name/);
    await user.click(screen.getByRole("button", { name: "Zurück" }));
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${BASE}/events/new?date=2026-10-14`,
    );
  });

  it("shows the archive notice instead of the form in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00Z" };
    renderNew("?date=2026-10-14");
    expect(await screen.findByRole("dialog", { name: "Kalender archiviert" })).toBeVisible();
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
  });

  it("validates on save, lists the errors with links and focuses the summary", async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByLabelText(/^Name/);
    expect(screen.getByRole("heading", { level: 2, name: "Neuer Termin" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Der Termin ist noch nicht vollständig.");
    await waitFor(() => expect(summary).toHaveFocus());
    const links = within(summary).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Bitte gib einen Namen ein.",
      "Bitte wähle ein Startdatum.",
    ]);
    const name = screen.getByLabelText(/^Name/);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(expect.stringContaining("Bitte gib einen Namen ein."));
    await user.click(links[1]);
    expect(screen.getByLabelText(/^Startdatum/)).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("creates a multi-day all-day event and returns to where it came from", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14", { background: `${BASE}?view=week&date=2026-10-14` });
    expect(
      await screen.findByText("Datum aus dem Kalender übernommen: Mi 14.10.2026."),
    ).toBeVisible();
    expect(screen.getByLabelText(/^Startdatum/)).toHaveValue("2026-10-14");

    await user.type(screen.getByLabelText(/^Name/), "Vereinsmeisterschaft");
    await user.type(screen.getByLabelText("Enddatum"), "2026-10-13");
    await waitFor(() =>
      expect(screen.getByLabelText("Enddatum")).toHaveAccessibleDescription(
        "Nur für mehrtägige Termine. Das Enddatum liegt vor dem Startdatum.",
      ),
    );
    // Also listed in the summary above the form.
    expect(screen.getByRole("alert")).toHaveTextContent("Das Enddatum liegt vor dem Startdatum.");
    await user.clear(screen.getByLabelText("Enddatum"));
    await user.type(screen.getByLabelText("Enddatum"), "2026-10-15");

    expect(screen.getByLabelText(/^Startzeit/)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /Ganztägig/ }));
    expect(screen.queryByLabelText(/^Startzeit/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Veröffentlicht" }));
    expect(screen.getByRole("button", { name: "Veröffentlicht" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByRole("combobox", { name: /^Ort/ }), "Schütz");
    await user.click(await screen.findByRole("option", { name: /Schützenhaus Waldblick/ }));
    expect(screen.getByRole("combobox", { name: /^Ort/ })).toHaveValue("Schützenhaus Waldblick");
    expect(screen.getByText("Waldstraße 12, 12345 Musterstadt")).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Karte mit dem Ort Schützenhaus Waldblick" }),
    ).toHaveAttribute("src", expect.stringContaining("/api/map/image/location/l1"));
    expect(screen.queryByRole("button", { name: "Position korrigieren" })).toBeNull();
    const audiences = screen.getByRole("group", { name: "Gruppen" });
    await user.click(within(audiences).getByRole("button", { name: "Jugend" }));

    await user.click(screen.getByRole("button", { name: "Termin speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/events", {
        name: "Vereinsmeisterschaft",
        date: "2026-10-14",
        dateEnd: "2026-10-15",
        isAllDay: true,
        timeBegin: "19:00",
        timeEnd: "21:00",
        isDraft: false,
        locationId: "l1",
        propertyIds: [],
        featureIds: [],
        targetGroupIds: ["g1"],
        note: "",
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${BASE}?view=week&date=2026-10-14`,
    );
  });

  it("offers 'create location' as the last suggestion and selects the new location", async () => {
    const user = userEvent.setup();
    apiPost.mockImplementation((path: string) =>
      path === "/api/clubs/c1/locations"
        ? Promise.resolve({ id: "l2", clubId: "c1", name: "Gasthof Linde" })
        : Promise.resolve({ id: "new" }),
    );
    renderNew("?date=2026-10-14");
    const input = await screen.findByRole("combobox", { name: /^Ort/ });
    await user.type(input, "Gasthof");
    const options = await screen.findAllByRole("option");
    expect(options[options.length - 1]).toHaveTextContent("Neuen Ort anlegen");
    await user.click(options[options.length - 1]);

    const dialog = await screen.findByRole("dialog", { name: "Neuer Ort" });
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Gasthof");
    await user.click(within(dialog).getByRole("button", { name: "Ort anlegen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/clubs/c1/locations",
        expect.objectContaining({ name: "Gasthof", latitude: null }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Neuer Ort" })).toBeNull());
    expect(screen.getByRole("combobox", { name: /^Ort/ })).toHaveValue("Gasthof Linde");
    expect(apiPost).not.toHaveBeenCalledWith("/api/calendars/k1/events", expect.anything());
  });

  it("rejects an end time before the start time on one day", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14");
    const end = await screen.findByLabelText(/^Endzeit/);
    await user.clear(end);
    await user.type(end, "18:00");
    await waitFor(() =>
      expect(end).toHaveAccessibleDescription("Die Endzeit liegt vor der Startzeit."),
    );
  });

  it("takes over the values of a template", async () => {
    const user = userEvent.setup();
    renderNew("?templateId=t1&date=2026-10-15");
    expect(await screen.findByLabelText(/^Name/)).toHaveValue("Training Luftgewehr");
    expect(
      screen.getByText(
        "Angaben aus der Vorlage „Training Luftgewehr“ übernommen. Du kannst sie hier anpassen.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText(/^Startdatum/)).toHaveValue("2026-10-15");
    expect(screen.getByLabelText(/^Startzeit/)).toHaveValue("19:00");
    expect(await screen.findByRole("combobox", { name: /^Ort/ })).toHaveValue(
      "Schützenhaus Waldblick",
    );
    const feats = screen.getByRole("group", { name: "Zusatzangebote" });
    expect(within(feats).getByRole("button", { name: "Bonusschießen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/calendars/k1/events",
        expect.objectContaining({
          name: "Training Luftgewehr",
          locationId: "l1",
          featureIds: ["f1"],
          targetGroupIds: ["g2"],
          eventTemplateId: "t1",
          isDraft: true,
        }),
      ),
    );
  });

  it("creates audiences inline and selects them", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({ id: "g9", clubId: "k1", name: "Senioren" });
    renderNew("?date=2026-10-14");
    await user.click(await screen.findByRole("button", { name: "Neue Gruppe anlegen" }));
    await user.type(screen.getByLabelText("Name"), "Senioren{Enter}");
    expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/target-groups", { name: "Senioren" });
  });

  it("asks before discarding unsaved changes", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14", { background: `${BASE}/events` });
    await user.type(await screen.findByLabelText(/^Name/), "Entwurf");
    await user.click(screen.getByRole("button", { name: "Schließen, Termin verwerfen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Änderungen verwerfen?");
    expect(dialog).toHaveTextContent("Wenn du die Seite jetzt verlässt, gehen sie verloren.");
    await user.click(within(dialog).getByRole("button", { name: "Weiter bearbeiten" }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Entwurf");

    await user.click(screen.getByRole("button", { name: "Schließen, Termin verwerfen" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Änderungen verwerfen",
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}/events`);
  });

  it("closes without asking when nothing changed", async () => {
    const user = userEvent.setup();
    renderNew("?date=2026-10-14");
    await screen.findByLabelText(/^Name/);
    await user.click(screen.getByRole("button", { name: "Schließen, Termin verwerfen" }));
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}?date=2026-10-14`);
  });
});

describe("EventFormModal – edit", () => {
  it("loads the event, shows status and saves changes with PATCH", async () => {
    const user = userEvent.setup();
    renderEdit("e1", { background: `${BASE}/events?status=published` });
    const name = await screen.findByLabelText(/^Name/);
    expect(name).toHaveValue("Herbstfest");
    expect(screen.getByRole("heading", { level: 2, name: "Termin bearbeiten" })).toBeVisible();
    const dialog = screen.getByRole("dialog", { name: "Termin bearbeiten" });
    expect(dialog).toHaveAccessibleDescription("Schießbetrieb 2026");
    expect(
      within(dialog).getByRole("button", { name: "Schließen, Änderungen verwerfen" }),
    ).toBeVisible();
    expect(screen.getByText("Änderungen sind sofort in den Feeds sichtbar.")).toBeVisible();
    await user.clear(name);
    await user.type(name, "Herbstfest 2026");
    await user.click(screen.getByRole("button", { name: "Entwurf" }));
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/calendars/k1/events/e1",
        expect.objectContaining({ name: "Herbstfest 2026", isDraft: true, targetGroupIds: ["g1"] }),
      ),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${BASE}/events?status=published`,
    );
  });

  it("deletes after a confirmation that names the consequences", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.click(await screen.findByRole("button", { name: "Termin löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Termin „Herbstfest“ löschen?");
    expect(dialog).toHaveTextContent("Der Termin am Sa 24.10.2026 wird dauerhaft entfernt.");
    expect(dialog).toHaveTextContent("verschwindet aus dem Kalender und aus allen Feeds");
    await user.click(within(dialog).getByRole("button", { name: "Termin löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/events/e1"));
    expect(await screen.findByTestId("location")).toHaveTextContent(BASE);
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00Z" };
    renderEdit();
    const heading = await screen.findByRole("heading", { level: 2, name: "Termin ansehen" });
    expect(screen.getByRole("dialog", { name: "Termin ansehen" })).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getByText("Der Kalender ist archiviert. Der Termin lässt sich nicht ändern."),
    ).toBeVisible();
    expect(await screen.findByLabelText(/^Name/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Termin speichern" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Termin löschen" })).toBeNull();
  });

  it("explains a missing event", async () => {
    renderEdit("gone");
    expect(await screen.findByRole("heading", { name: "Termin nicht gefunden" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Zu den Terminen" })).toHaveAttribute(
      "href",
      `${BASE}/events`,
    );
  });

  it("treats an event without access (403) as not found, not as a network error", async () => {
    renderEdit("foreign");
    expect(await screen.findByRole("heading", { name: "Termin nicht gefunden" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Erneut laden" })).toBeNull();
  });

  it("shows a load error instead of the form when the calendar cannot be loaded", async () => {
    const base = apiGet.getMockImplementation()!;
    mockApiGet(apiGet, (path: string) =>
      path === "/api/clubs/c1/calendars/k1"
        ? Promise.reject(new ApiError("Event not found", 404))
        : base(path),
    );
    renderRoute(newRoute, `${BASE}/events/new/form`, <EventFormModal />);
    expect(await screen.findByText("Der Kalender wurde nicht geladen")).toBeVisible();
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect(screen.getByRole("button", { name: "Erneut laden" })).toBeVisible();
  });
});

describe("EventFormModal – event of a series", () => {
  const seriesEvent = makeEvent({
    id: "s2",
    name: "Training",
    date: "2026-10-15",
    seriesId: "ser1",
    targetGroups: [{ targetGroup: groups[0] }],
    series: {
      id: "ser1",
      templateId: null,
      eventCount: 4,
      rule: {
        frequency: "weekly",
        weekday: 4,
        nth: null,
        startDate: "2026-10-03",
        until: "2026-10-31",
        count: null,
        skipHolidays: true,
      },
    },
  });

  beforeEach(() => {
    const base = apiGet.getMockImplementation()!;
    mockApiGet(apiGet, (path: string) =>
      path === "/api/calendars/k1/events/s2" ? Promise.resolve(seriesEvent) : base(path),
    );
  });

  it("names the series and its rule", async () => {
    renderEdit("s2");
    expect(await screen.findByText("Teil einer Terminreihe (4 Termine)")).toBeVisible();
    expect(screen.getByText(/^Wöchentlich am Donnerstag, .*03\.10\.2026 bis/)).toBeVisible();
    expect(screen.getByText("Wiederkehrend")).toBeVisible();
  });

  it("asks for the scope and sends only the changed fields for all events", async () => {
    const user = userEvent.setup();
    renderEdit("s2");
    const name = await screen.findByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Training neu");
    await user.clear(screen.getByLabelText(/^Startdatum/));
    await user.type(screen.getByLabelText(/^Startdatum/), "2026-10-16");
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Änderungen für die Terminreihe speichern?");
    expect(dialog).toHaveTextContent("gehört zu einer Terminreihe mit 4 Terminen");
    expect(dialog).toHaveTextContent("Das geänderte Datum gilt nur für diesen Termin.");
    // Focus starts on "Abbrechen" (like every confirmation)
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus(),
    );
    expect(apiPatch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Alle Termine der Reihe" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/events/s2", {
        name: "Training neu",
        date: "2026-10-16",
        scope: "all",
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(BASE);
  });

  it("saves only this event with the full form", async () => {
    const user = userEvent.setup();
    renderEdit("s2");
    await user.click(await screen.findByRole("button", { name: "Entwurf" }));
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("Das geänderte Datum");
    await user.click(within(dialog).getByRole("button", { name: "Nur diesen Termin" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/calendars/k1/events/s2",
        expect.objectContaining({ name: "Training", isDraft: true, targetGroupIds: ["g1"] }),
      ),
    );
    expect(apiPatch.mock.calls[0][1]).not.toHaveProperty("scope");
  });

  it("saves an unchanged event without asking for the scope", async () => {
    const user = userEvent.setup();
    renderEdit("s2");
    await screen.findByLabelText(/^Name/);
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/calendars/k1/events/s2",
        expect.objectContaining({ name: "Training" }),
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiPatch.mock.calls[0][1]).not.toHaveProperty("scope");
  });

  it("keeps the form when the scope question is cancelled", async () => {
    const user = userEvent.setup();
    renderEdit("s2");
    await user.click(await screen.findByRole("button", { name: "Entwurf" }));
    await user.click(screen.getByRole("button", { name: "Termin speichern" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
  });

  it("deletes this event or the whole series", async () => {
    const user = userEvent.setup();
    renderEdit("s2");
    await user.click(await screen.findByRole("button", { name: "Termin löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Termin „Training“ löschen?");
    expect(dialog).toHaveTextContent(
      "Der Termin am Do 15.10.2026 gehört zu einer Terminreihe mit 4 Terminen.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Alle Termine der Reihe" }));
    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/events/s2?scope=all"),
    );
  });

  it("deletes only this event on request", async () => {
    const user = userEvent.setup();
    renderEdit("s2");
    await user.click(await screen.findByRole("button", { name: "Termin löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Nur diesen Termin" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/events/s2"));
  });
});
