import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventsListPage from "../EventsListPage";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: vi.fn(),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

const sample = [
  makeEvent({
    id: "1",
    name: "Training Luftgewehr",
    date: "2026-10-01",
    targetGroups: [{ targetGroup: groups[1] }],
    location: { id: "l1", calendarid: "k1", name: "Schützenhaus Waldblick" },
  }),
  makeEvent({
    id: "2",
    name: "Jugendtraining",
    date: "2026-10-05",
    timeBegin: "18:00",
    timeEnd: "19:30",
    targetGroups: [{ targetGroup: groups[0] }],
  }),
  makeEvent({ id: "3", name: "Vorstandssitzung", date: "2026-10-07", isDraft: true }),
  makeEvent({
    id: "4",
    name: "Vereinsmeisterschaft",
    date: "2026-11-10",
    dateEnd: "2026-11-11",
    isAllDay: true,
    properties: [{ property: { id: "p", calendarid: "k1", name: "Wettkampf", icon: "🏆" } }],
    features: [{ feature: { id: "f", calendarid: "k1", name: "Bonusschießen" } }],
  }),
  makeEvent({ id: "5", name: "Arbeitsdienst", date: "2026-10-17", isDraft: true }),
];

let calendar: Record<string, unknown>;
let events: unknown[] | Error;

beforeEach(() => {
  calendar = { id: "k1", clubid: "c1", name: "Schießbetrieb 2026" };
  events = sample;
  for (const fn of [apiGet, apiPatch, apiDelete]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path === "/api/calendars/k1/events")
      return events instanceof Error ? Promise.reject(events) : Promise.resolve(events);
    return Promise.resolve([]);
  });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

function renderList(query = "") {
  return renderRoute(`${PATTERN}/events`, `${BASE}/events${query}`, <EventsListPage />);
}

const rows = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.classList.contains("ap-rowlink"))
    .map((a) => a.textContent);

describe("EventsListPage", () => {
  it("lists all events grouped by month with status as word and icon", async () => {
    renderList();
    expect(await screen.findByRole("heading", { level: 1, name: "Alle Termine" })).toBeVisible();
    await screen.findByRole("table");
    expect(screen.getByText("Schießbetrieb 2026 · 5 Termine")).toBeVisible();
    expect(rows()).toEqual([
      "Training Luftgewehr",
      "Jugendtraining",
      "Vorstandssitzung",
      "Arbeitsdienst",
      "Vereinsmeisterschaft",
    ]);
    expect(screen.getByRole("rowheader", { name: "Oktober 2026" })).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "November 2026" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Training Luftgewehr" })).toHaveAttribute(
      "href",
      `${BASE}/events/1`,
    );
    const row = screen.getByRole("link", { name: "Vereinsmeisterschaft" }).closest("tr")!;
    expect(row).toHaveTextContent("10.11.2026 – 11.11.2026");
    expect(row).toHaveTextContent("Ganztägig");
    expect(row).toHaveTextContent("Bonusschießen");
    expect(within(row).getByRole("img", { name: "Wettkampf" })).toHaveTextContent("🏆");
    const draftRow = screen.getByRole("link", { name: "Vorstandssitzung" }).closest("tr")!;
    expect(draftRow.querySelector('[data-status="draft"]')).toHaveTextContent("Entwurf");
    expect(screen.getByText("5 von 5 Terminen")).toBeVisible();
  });

  it("switches status tabs with counters and keeps the tab in the URL", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("table");
    const tabs = screen.getByRole("group", { name: "Nach Status filtern" });
    const draft = within(tabs).getByRole("button", { name: "Entwurf 2" });
    expect(within(tabs).getByRole("button", { name: "Alle 5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(tabs).getByRole("button", { name: "Veröffentlicht 3" })).toBeVisible();
    await user.click(draft);
    expect(draft).toHaveAttribute("aria-pressed", "true");
    expect(rows()).toEqual(["Vorstandssitzung", "Arbeitsdienst"]);
    expect(screen.getByText("2 von 5 Terminen")).toBeVisible();
  });

  it("searches by name and resets from the empty state", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("table");
    await user.type(screen.getByRole("searchbox", { name: "Termine nach Namen suchen" }), "train");
    expect(rows()).toEqual(["Training Luftgewehr", "Jugendtraining"]);
    expect(
      within(screen.getByRole("group", { name: "Nach Status filtern" })).getByRole("button", {
        name: "Alle 2",
      }),
    ).toBeVisible();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "Schwimmen");
    expect(screen.getByRole("heading", { name: "Keine Treffer für „Schwimmen“" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Suche zurücksetzen" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(rows()).toHaveLength(5);
  });

  it("filters by audience", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("table");
    const chips = screen.getByRole("group", { name: "Nach Zielgruppe filtern" });
    await user.click(within(chips).getByRole("button", { name: "Jugend" }));
    expect(rows()).toEqual(["Jugendtraining"]);
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(rows()).toHaveLength(5);
  });

  it("explains empty tabs", async () => {
    const user = userEvent.setup();
    events = sample.filter((e) => e.isDraft);
    renderList("?status=published");
    expect(
      await screen.findByRole("heading", { name: "Noch nichts veröffentlicht" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Entwürfe ansehen" }));
    expect(rows()).toEqual(["Vorstandssitzung", "Arbeitsdienst"]);
  });

  it("shows the empty calendar state", async () => {
    events = [];
    renderList();
    expect(await screen.findByRole("heading", { name: "Noch keine Termine" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Termine importieren" })).toHaveAttribute(
      "href",
      `${BASE}/import`,
    );
  });

  it("shows loading, then an error with retry", async () => {
    events = new Error("offline");
    renderList();
    expect(screen.getByText("Termine werden geladen.")).toBeInTheDocument();
    expect(
      await screen.findByText("Die Termine konnten nicht geladen werden."),
    ).toBeInTheDocument();
    events = sample;
    await userEvent.setup().click(screen.getByRole("button", { name: "Erneut laden" }));
    expect(await screen.findByRole("table")).toBeVisible();
  });

  it("publishes and deletes selected events with a confirmation", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("checkbox", { name: "Vorstandssitzung am 07.10.2026 auswählen" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Arbeitsdienst am 17.10.2026 auswählen" }),
    );
    const bar = screen.getByRole("region", { name: "Sammelaktionen" });
    expect(bar).toHaveTextContent("2 ausgewählt");
    // Nothing published selected: "Als Entwurf markieren" has nothing to do.
    expect(within(bar).getByRole("button", { name: "Als Entwurf markieren" })).toBeDisabled();

    await user.click(within(bar).getByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("2 Termine löschen?");
    expect(dialog).toHaveTextContent(
      "Die ausgewählten Termine werden dauerhaft entfernt: Vorstandssitzung (07.10.) und Arbeitsdienst (17.10.).",
    );
    expect(dialog).toHaveTextContent(
      "Löscht 2 Entwürfe unwiderruflich. Veröffentlichte Termine sind nicht betroffen.",
    );
    await user.click(within(dialog).getByRole("button", { name: "2 Termine löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2));
    expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/events/3");

    await user.click(screen.getByRole("checkbox", { name: "Alle angezeigten Termine auswählen" }));
    await user.click(
      within(screen.getByRole("region", { name: "Sammelaktionen" })).getByRole("button", {
        name: "Veröffentlichen",
      }),
    );
    // Only the drafts change.
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
    expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/events/5", { isDraft: false });
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00Z" };
    renderList();
    await screen.findByRole("table");
    expect(await screen.findByText("Archiviert, schreibgeschützt")).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "Termin anlegen" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Termine exportieren" })).toBeNull();
  });
});
