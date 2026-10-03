import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportPage from "../ImportPage";
import { BASE, PATTERN, groups, renderRoute } from "../events/__tests__/testUtils";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const route = `${PATTERN}/import`;
const url = `${BASE}/import`;

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:a",
  "SUMMARY:Training Luftgewehr",
  "DTSTART:20261008T190000",
  "DTEND:20261008T210000",
  "LOCATION:Schützenhaus Waldblick",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b",
  "SUMMARY:Training Luftgewehr",
  "DTSTART:20261015T190000",
  "DTEND:20261015T210000",
  "LOCATION:Schützenhaus Waldblick",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:c",
  "SUMMARY:Herbstfest",
  "DTSTART;VALUE=DATE:20261024",
  "LOCATION:Gasthof Zur Linde",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Ohne Datum",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const place = { id: "l1", calendarid: "k1", name: "Schützenhaus Waldblick" };
let calendar: Record<string, unknown>;
let existing: unknown[];

function icsFile(content = ics, name = "plan.ics") {
  return new File([content], name, { type: "text/calendar" });
}
function fileInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

beforeEach(() => {
  calendar = { id: "k1", clubid: "c1", name: "Schießbetrieb 2026" };
  existing = [];
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path.endsWith("/locations")) return Promise.resolve([place]);
    if (path.endsWith("/properties") || path.endsWith("/features")) return Promise.resolve([]);
    if (path === "/api/calendars/k1/events") return Promise.resolve(existing);
    return Promise.resolve([]);
  });
  apiPost.mockImplementation((path: string) => {
    if (path.endsWith("/locations")) return Promise.resolve({ id: "l2" });
    if (path.endsWith("/events/import")) return Promise.resolve({ imported: 3 });
    return Promise.resolve({});
  });
});

async function openReview(user: ReturnType<typeof userEvent.setup>, content = ics) {
  renderRoute(route, url, <ImportPage />);
  await screen.findByRole("heading", { name: "Termine importieren", level: 1 });
  await user.upload(fileInput(), icsFile(content));
  await user.click(
    await screen.findByRole("button", { name: /Datei prüfen/ }).then((b) => {
      expect(b).toBeEnabled();
      return b;
    }),
  );
  return screen.findByRole("heading", { level: 1, name: /Termine erkannt|Termin erkannt/ });
}

describe("ImportPage – upload", () => {
  it("starts with a labelled keyboard-reachable file input and a disabled next button", async () => {
    renderRoute(route, url, <ImportPage />);
    await screen.findByRole("heading", { name: "Termine importieren", level: 1 });
    expect(
      screen.getByRole("list", { name: "Fortschritt" }).querySelector("[aria-current='step']"),
    ).toHaveTextContent("Datei");
    const input = fileInput();
    expect(input).toHaveAccessibleName("Datei auswählen");
    expect(input).toHaveAttribute("accept", expect.stringContaining(".ics"));
    expect(screen.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
    expect(screen.getByText("Serien werden einzeln übernommen")).toBeInTheDocument();
  });

  it("rejects other file types", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderRoute(route, url, <ImportPage />);
    await screen.findByRole("heading", { name: "Termine importieren", level: 1 });
    await user.upload(fileInput(), new File(["x"], "plan.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falscher Dateityp");
    expect(screen.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
  });

  it("reports a file without events", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <ImportPage />);
    await screen.findByRole("heading", { name: "Termine importieren", level: 1 });
    await user.upload(fileInput(), icsFile("BEGIN:VCALENDAR\r\nEND:VCALENDAR"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keine Termine gefunden");
    expect(screen.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
  });

  it("announces the chosen file and enables the review", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <ImportPage />);
    await screen.findByRole("heading", { name: "Termine importieren", level: 1 });
    await user.upload(fileInput(), icsFile());
    expect(await screen.findByText("plan.ics: 3 Termine erkannt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Datei prüfen/ })).toBeEnabled();
  });
});

describe("ImportPage – review", () => {
  it("lists the groups, hints at skipped events and shows places", async () => {
    const user = userEvent.setup();
    await openReview(user);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "plan.ics: 3 Termine erkannt",
    );
    expect(
      screen.getByText(
        "in 2 Gruppen (gleicher Name). Importierte Termine werden als Entwurf angelegt.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Ein Termin wird übersprungen");
    const list = screen.getByRole("list", { name: "Termine prüfen" });
    expect(within(list).getByRole("heading", { name: "Training Luftgewehr" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Weitere Termine" })).toBeInTheDocument();
    expect(within(list).getByText("Vorhandener Ort: Schützenhaus Waldblick")).toBeInTheDocument();
    expect(within(list).getByText("Neuer Ort: Gasthof Zur Linde")).toBeInTheDocument();
    // the first group is open and has a real table with a caption
    expect(
      screen.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 von 3 ausgewählt")).toBeInTheDocument();
  });

  it("deselects single events and whole groups and updates the import button", async () => {
    const user = userEvent.setup();
    await openReview(user);
    const table = screen.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    await user.click(
      within(table).getByRole("checkbox", {
        name: /Training Luftgewehr am .*08\.10\.2026 auswählen/,
      }),
    );
    expect(screen.getByText("2 von 3 ausgewählt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 Termine importieren" })).toBeEnabled();
    await user.click(
      screen.getByRole("checkbox", { name: /Training Luftgewehr: 1 von 2 ausgewählt/ }),
    );
    expect(screen.getByText("3 von 3 ausgewählt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Auswahl aufheben" }));
    expect(screen.getByText("0 von 3 ausgewählt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Termine importieren" })).toBeDisabled();
  });

  it("marks events that already exist and can deselect them", async () => {
    existing = [{ id: "e1", name: "herbstfest", date: "2026-10-24T00:00:00+00:00" }];
    const user = userEvent.setup();
    await openReview(user);
    expect(await screen.findByText("Ein Termin gibt es vielleicht schon")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Doppelte abwählen" }));
    expect(screen.getByText("2 von 3 ausgewählt")).toBeInTheDocument();
  });

  it("sets the status for all selected events", async () => {
    const user = userEvent.setup();
    await openReview(user);
    const bulk = screen.getByRole("region", { name: "Für alle ausgewählten Termine setzen" });
    await user.click(within(bulk).getByRole("button", { name: /Veröffentlicht/ }));
    expect(within(bulk).getByText(/sofort in öffentlichen Feeds/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    expect(within(table).getAllByText("Veröffentlicht")).toHaveLength(2);
  });

  it("edits a group in the dialog and validates", async () => {
    const user = userEvent.setup();
    await openReview(user);
    await user.click(screen.getByRole("button", { name: "Gruppe Training Luftgewehr bearbeiten" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Gruppe bearbeiten: Training Luftgewehr",
    });
    const name = within(dialog).getByLabelText(/Name der Gruppe/);
    await user.clear(name);
    await user.click(within(dialog).getByRole("button", { name: "Änderungen übernehmen" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Bitte gib einen Namen ein.",
    );
    await user.type(name, "Training Kleinkaliber");
    await user.click(within(dialog).getByRole("button", { name: "Änderungen übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Training Kleinkaliber" })).toBeInTheDocument();
  });

  it("edits one event", async () => {
    const user = userEvent.setup();
    await openReview(user);
    await user.click(
      screen.getByRole("button", {
        name: /Termin Training Luftgewehr am .*15\.10\.2026 bearbeiten/,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Termin bearbeiten" });
    const end = within(dialog).getByLabelText(/Endzeit/);
    await user.clear(end);
    await user.type(end, "22:30");
    await user.click(within(dialog).getByRole("button", { name: "Änderungen übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(/19:00 bis 22:30|19:00 – 22:30/)).toBeInTheDocument();
  });
});

describe("ImportPage – import and result", () => {
  it("creates new places, imports only the selected events as drafts and shows the result", async () => {
    const user = userEvent.setup();
    await openReview(user);
    const table = screen.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    await user.click(within(table).getByRole("checkbox", { name: /15\.10\.2026 auswählen/ }));
    await user.click(screen.getByRole("button", { name: "2 Termine importieren" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "3 Termine importiert" });
    expect(heading).toHaveFocus();

    expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/locations", {
      name: "Gasthof Zur Linde",
    });
    const call = apiPost.mock.calls.find(([p]) => String(p).endsWith("/events/import"))!;
    const sent = (call[1] as { events: Record<string, unknown>[] }).events;
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => e.name)).toEqual(["Training Luftgewehr", "Herbstfest"]);
    expect(sent[0]).toMatchObject({
      date: "2026-10-08",
      isDraft: true,
      locationId: "l1",
      isAllDay: false,
    });
    expect(sent[1]).toMatchObject({ date: "2026-10-24", isAllDay: true, locationId: "l2" });

    expect(screen.getByText("2 als Entwurf angelegt")).toBeInTheDocument();
    expect(screen.getByText("1 neuer Ort angelegt: Gasthof Zur Linde")).toBeInTheDocument();
    expect(screen.getByText("1 Termin übersprungen")).toBeInTheDocument();
    expect(screen.getByText("1 Termin der Datei nicht lesbar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zum Kalender" })).toHaveAttribute("href", BASE);
    expect(screen.getByRole("link", { name: "Alle Termine ansehen" })).toHaveAttribute(
      "href",
      `${BASE}/events`,
    );
    await user.click(screen.getByRole("button", { name: "Weitere Datei importieren" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Termine importieren" }),
    ).toBeInTheDocument();
  });

  it("shows a failure and goes back to the review with the edits kept", async () => {
    apiPost.mockImplementation((path: string) =>
      path.endsWith("/events/import")
        ? Promise.reject(new Error("API error 500"))
        : Promise.resolve({ id: "l2" }),
    );
    const user = userEvent.setup();
    await openReview(user);
    await user.click(screen.getByRole("button", { name: "3 Termine importieren" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Import fehlgeschlagen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Es wurde nichts importiert");
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("button", { name: "3 Termine importieren" })).toBeEnabled();
  });
});

describe("ImportPage – partial failure", () => {
  it("shows how many events were imported, lists the rest and offers no second import", async () => {
    const events = Array.from({ length: 502 }, (_, i) => {
      const day = String(1 + (i % 28)).padStart(2, "0");
      return [
        "BEGIN:VEVENT",
        `UID:e${i}`,
        `SUMMARY:Termin ${String(i).padStart(3, "0")}`,
        `DTSTART;VALUE=DATE:${2027 + Math.floor(i / 336)}${String(1 + (Math.floor(i / 28) % 12)).padStart(2, "0")}${day}`,
        "END:VEVENT",
      ].join("\r\n");
    });
    const big = ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
    const batches: number[] = [];
    apiPost.mockImplementation((path: string, body: { events: unknown[] }) => {
      if (!path.endsWith("/events/import")) return Promise.resolve({ id: "l2" });
      batches.push(body.events.length);
      return batches.length === 1
        ? Promise.resolve({ imported: body.events.length })
        : Promise.reject(new Error("API error 500"));
    });
    const user = userEvent.setup();
    await openReview(user, big);
    await user.click(screen.getByRole("button", { name: "502 Termine importieren" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Import nur teilweise gelungen" }),
    ).toBeInTheDocument();
    expect(batches).toEqual([500, 2]);
    expect(screen.getByRole("alert")).toHaveTextContent("500 Termine wurden angelegt");
    expect(
      screen.getByRole("heading", { level: 2, name: "2 Termine nicht importiert" }),
    ).toBeInTheDocument();
    const list = screen.getByRole("heading", { level: 2, name: /nicht importiert/ })
      .parentElement as HTMLElement;
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Termin 500")).toBeInTheDocument();
    expect(within(list).getByText("Termin 501")).toBeInTheDocument();
    // No way back into the review (a second import would create duplicates).
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /importieren/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Alle Termine ansehen" })).toHaveAttribute(
      "href",
      `${BASE}/events`,
    );
    expect(batches).toHaveLength(2);
  }, 30000);
});

describe("ImportPage – archived calendar", () => {
  it("does not offer the import", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderRoute(route, url, <ImportPage />);
    expect(await screen.findByText("Kalender archiviert")).toBeInTheDocument();
    expect(fileInput()).toBeNull();
  });
});
