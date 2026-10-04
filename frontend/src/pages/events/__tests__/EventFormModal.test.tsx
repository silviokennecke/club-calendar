import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventFormModal from "../EventFormModal";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));
// mapbox-gl does not run in jsdom.
vi.mock("@/components/events/EventLocationMap", () => ({
  default: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

const locations = [
  {
    id: "l1",
    calendarid: "k1",
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
  calendar = { id: "k1", clubid: "c1", name: "Schießbetrieb 2026" };
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path.endsWith("/locations")) return Promise.resolve(locations);
    if (path.endsWith("/properties")) return Promise.resolve(properties);
    if (path.endsWith("/features")) return Promise.resolve(features);
    if (path.endsWith("/templates")) return Promise.resolve([template]);
    if (path === "/api/calendars/k1/events/e1") return Promise.resolve(existing);
    if (path === "/api/calendars/k1/events/gone") return Promise.reject(new Error("API error 404"));
    if (path === "/api/calendars/k1/events/foreign")
      return Promise.reject(new Error("API error 403"));
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
    expect(screen.getByRole("heading", { level: 1, name: "Neuer Termin" })).toBeVisible();
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
    expect(name).toHaveAccessibleDescription("Bitte gib einen Namen ein.");
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
    await user.selectOptions(screen.getByRole("combobox", { name: /^Ort/ }), "l1");
    expect(screen.getByText("Waldstraße 12, 12345 Musterstadt")).toBeVisible();
    expect(
      await screen.findByRole("region", { name: "Karte mit dem Ort Schützenhaus Waldblick" }),
    ).toBeInTheDocument();
    const audiences = screen.getByRole("group", { name: "Zielgruppen" });
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
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${BASE}?view=week&date=2026-10-14`,
    );
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
    expect(await screen.findByRole("combobox", { name: /^Ort/ })).toHaveValue("l1");
    const feats = screen.getByRole("group", { name: "Features" });
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
    apiPost.mockResolvedValueOnce({ id: "g9", calendarid: "k1", name: "Senioren" });
    renderNew("?date=2026-10-14");
    await user.click(await screen.findByRole("button", { name: "Neue Zielgruppe anlegen" }));
    await user.type(screen.getByLabelText("Name"), "Senioren{Enter}");
    expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/target-groups", { name: "Senioren" });
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
    expect(screen.getByRole("heading", { level: 1, name: "Termin bearbeiten" })).toBeVisible();
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
    const heading = await screen.findByRole("heading", { level: 1, name: "Termin ansehen" });
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
    apiGet.mockImplementation((path: string) =>
      path === "/api/clubs/c1/calendars/k1"
        ? Promise.reject(new Error("API error 404"))
        : base(path),
    );
    renderRoute(newRoute, `${BASE}/events/new/form`, <EventFormModal />);
    expect(await screen.findByText("Der Kalender wurde nicht geladen")).toBeVisible();
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect(screen.getByRole("button", { name: "Erneut laden" })).toBeVisible();
  });
});
