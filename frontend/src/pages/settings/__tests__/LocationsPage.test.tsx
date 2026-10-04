import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LocationsPage from "../LocationsPage";
import { BASE, PATTERN, renderRoute } from "../../events/__tests__/testUtils";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const apiFetch = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

// No real map in tests (mapbox-gl needs WebGL): stand-ins that expose what the page hands over.
vi.mock("@/components/locations/PositionMap", () => ({
  default: (p: {
    latitude: number | null;
    longitude: number | null;
    onPick: (lat: number, lng: number) => void;
    label: string;
  }) => (
    <div role="region" aria-label={p.label} data-testid="position-map">
      <span data-testid="position">
        {p.latitude == null ? "none" : `${p.latitude},${p.longitude}`}
      </span>
      <button type="button" onClick={() => p.onPick(48.1, 11.5)}>
        pick-position
      </button>
    </div>
  ),
}));
vi.mock("@/components/locations/LocationsOverviewMap", () => ({
  default: (p: {
    locations: { id: string; title: string }[];
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    label: string;
  }) => (
    <div
      role="region"
      aria-label={p.label}
      data-testid="overview-map"
      data-selected={p.selectedId ?? ""}
    >
      {p.locations.map((l) => (
        <button key={l.id} type="button" onClick={() => p.onSelect?.(l.id)}>
          pin-{l.title}
        </button>
      ))}
    </div>
  ),
}));

const haus = {
  id: "l1",
  calendarid: "k1",
  name: "Schützenhaus Waldblick",
  street: "Waldstraße 12",
  zip: "12345",
  city: "Musterstadt",
  country: "Deutschland",
  latitude: 48.0,
  longitude: 11.0,
};
const heim = { id: "l2", calendarid: "k1", name: "Vereinsheim Mitte", street: "Marktplatz 5" };

let calendar: Record<string, unknown>;
let locations: unknown[];

const route = `${PATTERN}/settings/locations`;
const url = `${BASE}/settings/locations`;

function json(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  calendar = { id: "k1", clubid: "c1", name: "Schießbetrieb 2026", timezone: "Europe/Berlin" };
  locations = [haus, heim];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete, apiFetch]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path.endsWith("/locations")) return Promise.resolve(locations);
    if (path.endsWith("/events"))
      return Promise.resolve([{ locationId: "l1" }, { locationId: "l1" }, { locationId: null }]);
    if (path.endsWith("/templates")) return Promise.resolve([{ locationId: "l1" }]);
    return Promise.resolve([]);
  });
  apiPost.mockImplementation((_p: string, body: object) => Promise.resolve({ id: "l9", ...body }));
  apiPatch.mockImplementation((_p: string, body: object) => Promise.resolve({ id: "l1", ...body }));
  apiDelete.mockResolvedValue(undefined);
  apiFetch.mockImplementation((path: string) => {
    if (path.includes("geocode/suggest"))
      return json({
        suggestions: [
          {
            label: "Waldstraße 12, 12345 Musterstadt",
            lat: 48.2,
            lng: 11.2,
            street: "Waldstraße 12",
            zip: "12345",
            city: "Musterstadt",
            country: "Deutschland",
          },
          {
            label: "Waldweg 12, 12347 Musterdorf",
            lat: 48.3,
            lng: 11.3,
            street: "Waldweg 12",
            zip: "12347",
            city: "Musterdorf",
            country: "Deutschland",
          },
        ],
      });
    if (path.includes("geocode/reverse"))
      return json({
        label: "x",
        street: "Hangweg 3",
        zip: "99999",
        city: "Hanghausen",
        country: "Deutschland",
      });
    return json({}, false, 404);
  });
});

describe("LocationsPage", () => {
  it("is fully usable as a list without the map and gives the map a text alternative", async () => {
    renderRoute(route, url, <LocationsPage />);
    expect(await screen.findByRole("heading", { name: "Alle Orte (2)" })).toBeInTheDocument();
    const rows = screen
      .getAllByRole("listitem")
      .filter((li) => li.className.includes("ap-listrow"));
    expect(rows[0]).toHaveTextContent("Schützenhaus Waldblick");
    expect(rows[0]).toHaveTextContent("Waldstraße 12, 12345 Musterstadt, Deutschland");
    expect(rows[1]).toHaveTextContent("Vereinsheim Mitte");
    expect(rows[1]).toHaveTextContent("Keine Position");
    expect(
      await screen.findByRole("region", { name: "Übersichtskarte mit 1 Ort" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Die Karte zeigt 1 Ort mit Position/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vereinsheim Mitte bearbeiten" }),
    ).toBeInTheDocument();
  });

  it("marks a place on the map from the list and from the pin", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await user.click(
      await screen.findByRole("button", { name: "Schützenhaus Waldblick auf Karte zeigen" }),
    );
    expect(screen.getByTestId("overview-map")).toHaveAttribute("data-selected", "l1");
    expect(screen.getByText("Auf Karte markiert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Schützenhaus Waldblick auf Karte zeigen" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("creates a place from typed address fields", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    expect(screen.getByRole("heading", { name: "Neuen Ort anlegen" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Name/), "Gasthof Linde");
    await user.type(screen.getByLabelText("Straße"), "Dorfstraße 1");
    await user.type(screen.getByLabelText("PLZ"), "12345");
    await user.type(screen.getByLabelText("Stadt"), "Musterstadt");
    await user.click(screen.getByRole("button", { name: "Ort speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/locations", {
        name: "Gasthof Linde",
        street: "Dorfstraße 1",
        zip: "12345",
        city: "Musterstadt",
        country: null,
        latitude: null,
        longitude: null,
      }),
    );
    expect(await screen.findByRole("heading", { name: "Ort bearbeiten" })).toBeInTheDocument();
  });

  it("requires a name or a street", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    await user.click(screen.getByRole("button", { name: "Ort speichern" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte mindestens einen Namen oder eine Straße eingeben.");
    await user.click(within(alert).getByRole("link"));
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("searches an address and takes over fields and position from a suggestion", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    await user.type(screen.getByLabelText("Adresse suchen"), "Waldstr");
    const results = await screen.findByRole("list", { name: "Adressvorschläge" });
    expect(screen.getByText("2 Vorschläge gefunden")).toBeInTheDocument();
    await user.click(within(results).getByRole("button", { name: "Waldweg 12, 12347 Musterdorf" }));
    expect(screen.getByLabelText("Straße")).toHaveValue("Waldweg 12");
    expect(screen.getByLabelText("PLZ")).toHaveValue("12347");
    expect(screen.getByLabelText("Stadt")).toHaveValue("Musterdorf");
    expect(screen.getByTestId("position")).toHaveTextContent("48.3,11.3");
    expect(screen.queryByRole("list", { name: "Adressvorschläge" })).not.toBeInTheDocument();
  });

  it("explains when the address search is unavailable", async () => {
    apiFetch.mockImplementation(() => json({}, false, 503));
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    await user.type(screen.getByLabelText("Adresse suchen"), "Wald");
    expect(
      await screen.findByText(/Die Adresssuche ist gerade nicht verfügbar/),
    ).toBeInTheDocument();
  });

  it("sets the position on the map and fills only empty address fields", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    await user.type(screen.getByLabelText("Straße"), "Eigene Straße 1");
    await user.click(screen.getByRole("button", { name: "pick-position" }));
    await waitFor(() => expect(screen.getByLabelText("Stadt")).toHaveValue("Hanghausen"));
    expect(screen.getByLabelText("Straße")).toHaveValue("Eigene Straße 1");
    expect(screen.getByLabelText("PLZ")).toHaveValue("99999");
    expect(
      screen.getByText("Leere Adressfelder wurden aus der Position ergänzt: PLZ, Stadt, Land."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Breitengrad")).toHaveValue("48.1");
    await user.click(screen.getByRole("button", { name: "Ort speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/calendars/k1/locations",
        expect.objectContaining({ latitude: 48.1, longitude: 11.5, street: "Eigene Straße 1" }),
      ),
    );
  });

  it("sets the position by keyboard with the coordinate fields", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    await user.type(screen.getByLabelText(/^Name/), "Waldlichtung");
    await user.click(screen.getByText("Koordinaten von Hand eingeben"));
    await user.type(screen.getByLabelText("Breitengrad"), "47,5");
    await user.type(screen.getByLabelText("Längengrad"), "10.25");
    expect(screen.getByTestId("position")).toHaveTextContent("47.5,10.25");
    await user.clear(screen.getByLabelText("Breitengrad"));
    await user.type(screen.getByLabelText("Breitengrad"), "95");
    expect(screen.getByText("Bitte eine Zahl zwischen −90 und 90 eingeben.")).toBeInTheDocument();
  });

  it("refuses to save while a coordinate field holds text that is not a number", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    await user.type(screen.getByLabelText(/^Name/), "Waldlichtung");
    await user.click(screen.getByText("Koordinaten von Hand eingeben"));
    await user.type(screen.getByLabelText("Breitengrad"), "abc");
    await user.click(screen.getByRole("button", { name: "Ort speichern" }));

    expect(apiPost).not.toHaveBeenCalled();
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent("Bitte korrigiere die Koordinaten");
    expect(summary).toHaveTextContent("Breitengrad: Bitte eine Zahl zwischen −90 und 90 eingeben.");
    expect(screen.getByLabelText("Breitengrad")).toHaveAttribute("aria-invalid", "true");

    // The summary links to the field; a valid value lets the save through.
    await user.click(within(summary).getByRole("link"));
    expect(screen.getByLabelText("Breitengrad")).toHaveFocus();
    await user.clear(screen.getByLabelText("Breitengrad"));
    await user.type(screen.getByLabelText("Breitengrad"), "47.5");
    await user.type(screen.getByLabelText("Längengrad"), "10.25");
    await user.click(screen.getByRole("button", { name: "Ort speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/calendars/k1/locations",
        expect.objectContaining({ latitude: 47.5, longitude: 10.25 }),
      ),
    );
  });

  it("edits a place and saves with PATCH", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await user.click(await screen.findByRole("button", { name: "Vereinsheim Mitte bearbeiten" }));
    expect(await screen.findByRole("heading", { name: "Ort bearbeiten" })).toHaveFocus();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Vereinsheim Mitte");
    await user.clear(screen.getByLabelText(/^Name/));
    await user.type(screen.getByLabelText(/^Name/), "Vereinsheim");
    await user.click(screen.getByRole("button", { name: "Ort speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/calendars/k1/locations/l2",
        expect.objectContaining({ name: "Vereinsheim", street: "Marktplatz 5" }),
      ),
    );
  });

  it("asks before dropping unsaved changes when another place is opened", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await user.click(await screen.findByRole("button", { name: "Vereinsheim Mitte bearbeiten" }));
    await user.type(await screen.findByLabelText(/^Name/), " neu");
    await user.click(screen.getByRole("button", { name: "Schützenhaus Waldblick bearbeiten" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /Abbrechen|Weiter bearbeiten/ }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Vereinsheim Mitte neu");
    await user.click(screen.getByRole("button", { name: "Schützenhaus Waldblick bearbeiten" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: /verwerfen/ }),
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Schützenhaus Waldblick");
  });

  it("deletes a place after confirming and names how many events are affected", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <LocationsPage />);
    await user.click(
      await screen.findByRole("button", { name: "Schützenhaus Waldblick bearbeiten" }),
    );
    await user.click(await screen.findByRole("button", { name: "Ort löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Ort „Schützenhaus Waldblick“ löschen?",
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "2 Termine mit diesem Ort haben danach keinen Ort mehr. 1 Vorlage verliert ihren Standardort.",
      ),
    );
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Ort löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/locations/l1"));
  });

  it("shows the empty state", async () => {
    locations = [];
    renderRoute(route, url, <LocationsPage />);
    expect(await screen.findByRole("heading", { name: "Noch keine Orte" })).toBeInTheDocument();
    expect(screen.queryByTestId("overview-map")).not.toBeInTheDocument();
  });

  it("shows an error with retry when loading fails", async () => {
    apiGet.mockImplementation((path: string) =>
      path === "/api/clubs/c1/calendars/k1"
        ? Promise.resolve(calendar)
        : Promise.reject(new Error("API error 500")),
    );
    renderRoute(route, url, <LocationsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Orte konnten nicht geladen werden.",
    );
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderRoute(route, url, <LocationsPage />);
    await screen.findByRole("heading", { name: "Alle Orte (2)" });
    expect(screen.getByRole("button", { name: "Archivierung aufheben" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Ort anlegen|bearbeiten/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Adresse suchen")).not.toBeInTheDocument();
    expect(screen.getByText("Vereinsheim Mitte")).toBeInTheDocument();
  });
});
