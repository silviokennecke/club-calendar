import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TemplatesPage from "../TemplatesPage";
import TemplateEditPage from "../TemplateEditPage";
import { BASE, PATTERN, groups, renderRoute } from "../events/__tests__/testUtils";
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

const place = {
  id: "l1",
  clubId: "k1",
  name: "Schützenhaus Waldblick",
  street: "Waldstraße 12",
};
const place2 = { id: "l2", clubId: "k1", name: "Vereinsheim Mitte" };
const properties = [{ id: "p1", calendarid: "k1", name: "Schützentracht", icon: "🧥" }];
const features = [{ id: "f1", calendarid: "k1", name: "Bonusschießen" }];

function makeTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    calendarId: "k1",
    name: "Training Luftgewehr",
    timezone: "Europe/Berlin",
    timeBegin: "19:00:00",
    timeEnd: "21:00:00",
    locationId: "l1",
    location: place,
    properties: [],
    features: [{ feature: features[0] }],
    targetGroups: [{ targetGroup: groups[1] }],
    ...over,
  };
}
const youthTemplate = makeTemplate({
  id: "t2",
  name: "Jugendtraining",
  timeBegin: "18:00:00",
  timeEnd: "19:30:00",
  location: place2,
  locationId: "l2",
  properties: [{ property: properties[0] }],
  features: [],
  targetGroups: [{ targetGroup: groups[0] }],
});

let calendar: Record<string, unknown>;
let templates: unknown[];

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: "Europe/Berlin" };
  templates = [makeTemplate(), youthTemplate];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path === "/api/calendars/k1/templates") return Promise.resolve(templates);
    if (path === "/api/calendars/k1/templates/t1") return Promise.resolve(templates[0]);
    if (path === "/api/calendars/k1/templates/gone")
      return Promise.reject(new ApiError("Template not found", 404));
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path.endsWith("/locations")) return Promise.resolve([place, place2]);
    if (path.endsWith("/properties")) return Promise.resolve(properties);
    if (path.endsWith("/features")) return Promise.resolve(features);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({ id: "new" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

const listRoute = `${PATTERN}/templates`;
const listUrl = `${BASE}/templates`;

describe("TemplatesPage", () => {
  it("lists templates with time, place, audiences and tags and links to the actions", async () => {
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Vorlagen" })).toBeInTheDocument();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(within(first).getByRole("heading", { name: "Training Luftgewehr" })).toBeInTheDocument();
    expect(within(first).getByText(/19:00 – 21:00/)).toBeInTheDocument();
    expect(within(first).getByText(/Schützenhaus Waldblick/)).toBeInTheDocument();
    expect(within(first).getByText("Erwachsene")).toBeInTheDocument();
    expect(within(first).getByText("Bonusschießen")).toBeInTheDocument();
    expect(
      within(first).getByRole("link", { name: "Vorlage Training Luftgewehr bearbeiten" }),
    ).toHaveAttribute("href", `${BASE}/templates/t1`);
    expect(within(first).getByRole("link", { name: "Termin aus Vorlage" })).toHaveAttribute(
      "href",
      `${BASE}/events/new/template/t1`,
    );
    expect(within(items[1]).getByText("Schützentracht")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vorlage anlegen" })).toHaveAttribute(
      "href",
      `${BASE}/templates/new`,
    );
  });

  it("shows a template without times as all-day", async () => {
    templates = [makeTemplate({ timeBegin: null, timeEnd: null, timezone: null })];
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    const [item] = await screen.findAllByRole("listitem");
    expect(within(item).getByText(/Ganztägig/)).toBeInTheDocument();
  });

  it("names how many events were created from a template when deleting it", async () => {
    templates = [makeTemplate({ eventCount: 4 })];
    const user = userEvent.setup();
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    await user.click(
      await screen.findByRole("button", { name: "Vorlage Training Luftgewehr löschen" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      await within(dialog).findByText(
        "Die 4 bereits aus dieser Vorlage erzeugten Termine bleiben unverändert.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the empty state with a way to create a template", async () => {
    templates = [];
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    expect(await screen.findByRole("heading", { name: "Noch keine Vorlagen" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Vorlage anlegen" })).toHaveLength(2);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("filters by search and offers to reset it", async () => {
    const user = userEvent.setup();
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    await screen.findByRole("heading", { name: "Training Luftgewehr" });
    await user.type(screen.getByRole("searchbox"), "jugend");
    expect(screen.queryByRole("heading", { name: "Training Luftgewehr" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jugendtraining" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 von 2 Vorlagen");
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "xyz");
    expect(
      await screen.findByRole("heading", { name: "Keine Treffer für „xyz“" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Suche zurücksetzen" }));
    expect(await screen.findByRole("heading", { name: "Training Luftgewehr" })).toBeInTheDocument();
  });

  it("deletes after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    await user.click(
      await screen.findByRole("button", { name: "Vorlage Training Luftgewehr löschen" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Vorlage „Training Luftgewehr“ löschen?",
    });
    expect(
      within(dialog).getByText("Bereits aus dieser Vorlage erzeugte Termine bleiben unverändert."),
    ).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Vorlage löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/templates/t1"));
  });

  it("shows an error with retry when loading fails", async () => {
    mockApiGet(apiGet, (path: string) => {
      if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
      if (path === "/api/calendars/k1/templates")
        return Promise.reject(new ApiError("Internal error", 500));
      return Promise.resolve([]);
    });
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Vorlagen konnten nicht geladen werden",
    );
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderRoute(listRoute, listUrl, <TemplatesPage />);
    await screen.findByRole("heading", { name: "Training Luftgewehr" });
    expect(screen.queryByRole("link", { name: "Vorlage anlegen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /löschen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Termin aus Vorlage" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /ansehen/ })).toHaveLength(2);
  });
});

describe("TemplateEditPage – new", () => {
  const route = `${PATTERN}/templates/new`;
  const url = `${BASE}/templates/new`;

  it("validates, then saves a new template and returns to the list", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Neue Vorlage" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vorlage löschen" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Vorlage ist noch nicht vollständig.",
    );
    expect(screen.getByLabelText(/Name/, { selector: "input" })).toHaveAccessibleDescription(
      "Bitte gib einen Namen ein.",
    );
    expect(apiPost).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Name/, { selector: "input" }), " Vereinsabend ");
    // Times are optional, but only together (design: new templates start empty)
    expect(screen.getByLabelText(/Startzeit/)).toHaveValue("");
    await user.type(screen.getByLabelText(/Startzeit/), "20:00");
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));
    expect(await screen.findByLabelText(/Endzeit/)).toHaveAccessibleDescription(
      expect.stringContaining("Bitte gib auch eine Endzeit ein oder lass beide Zeiten leer."),
    );
    expect(apiPost).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Endzeit/), "21:00");
    await user.selectOptions(screen.getByLabelText(/Standardort/), "l2");
    await user.click(await screen.findByRole("button", { name: "Bonusschießen" }));
    await user.click(screen.getByRole("button", { name: "Erwachsene" }));
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/templates", {
      name: "Vereinsabend",
      timezone: "Europe/Berlin",
      timeBegin: "20:00",
      timeEnd: "21:00",
      locationId: "l2",
      propertyIds: [],
      featureIds: ["f1"],
      targetGroupIds: ["g2"],
      note: "",
    });
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}/templates`);
  });

  it("saves a template without times (events from it are all-day)", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    await screen.findByRole("heading", { level: 1, name: "Neue Vorlage" });
    expect(screen.getByLabelText(/Endzeit/)).toHaveAccessibleDescription(
      expect.stringContaining(
        "Ohne Start- und Endzeit werden Termine aus dieser Vorlage ganztägig.",
      ),
    );
    await user.type(screen.getByLabelText(/Name/, { selector: "input" }), "Vereinsfest");
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(
      "/api/calendars/k1/templates",
      expect.objectContaining({ name: "Vereinsfest", timeBegin: null, timeEnd: null }),
    );
  });

  it("offers the zone select when not using the club zone", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    await screen.findByRole("heading", { name: "Neue Vorlage" });
    expect(screen.queryByLabelText("Zeitzone")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: /Zeitzone des Vereins verwenden/ }));
    await user.selectOptions(screen.getByLabelText("Zeitzone"), "Europe/London");
    await user.type(screen.getByLabelText(/Name/, { selector: "input" }), "X");
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toMatchObject({ timezone: "Europe/London" });
  });

  it("reports a failed save and stays on the form", async () => {
    apiPost.mockRejectedValue(new Error("API error 500"));
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    await screen.findByRole("heading", { name: "Neue Vorlage" });
    await user.type(screen.getByLabelText(/Name/, { selector: "input" }), "X");
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1, name: "Neue Vorlage" })).toBeInTheDocument();
  });
});

describe("TemplateEditPage – edit", () => {
  const route = `${PATTERN}/templates/:templateId`;
  const url = `${BASE}/templates/t1`;

  it("prefills the form, saves changes and deletes with a confirmation", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Vorlage bearbeiten: Training Luftgewehr",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/, { selector: "input" })).toHaveValue("Training Luftgewehr");
    expect(screen.getByLabelText(/Startzeit/)).toHaveValue("19:00");
    await waitFor(() => expect(screen.getByLabelText(/Standardort/)).toHaveValue("l1"));
    expect(screen.getByRole("button", { name: "Bonusschießen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Änderungen gelten für neue Termine")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Endzeit/));
    await user.type(screen.getByLabelText(/Endzeit/), "22:00");
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/calendars/k1/templates/t1",
      expect.objectContaining({
        timeEnd: "22:00",
        timezone: "Europe/Berlin",
        featureIds: ["f1"],
        targetGroupIds: ["g2"],
      }),
    );
  });

  it("warns before discarding changes", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    await screen.findByRole("heading", { level: 1 });
    await user.type(screen.getByLabelText(/Name/, { selector: "input" }), " neu");
    await user.click(screen.getByRole("link", { name: "Abbrechen" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("deletes after confirming", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <TemplateEditPage />);
    await user.click(await screen.findByRole("button", { name: "Vorlage löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Vorlage „Training Luftgewehr“ löschen?",
    });
    expect(
      within(dialog).getByText(/Bereits aus dieser Vorlage erzeugte Termine bleiben unverändert/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Vorlage löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/templates/t1"));
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}/templates`);
  });

  it("shows a not-found state", async () => {
    renderRoute(route, `${BASE}/templates/gone`, <TemplateEditPage />);
    expect(
      await screen.findByRole("heading", { name: "Vorlage nicht gefunden" }),
    ).toBeInTheDocument();
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderRoute(route, url, <TemplateEditPage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Vorlage: Training Luftgewehr" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vorlage speichern" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Name/, { selector: "input" })).toBeDisabled();
  });
});
