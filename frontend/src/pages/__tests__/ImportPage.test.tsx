import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportPage from "../ImportPage";
import { BASE, PATTERN, groups, renderRoute } from "../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import("@/lib/api")>()).ApiError,
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

type Body = { events: Record<string, unknown>[]; locations: { tempId: string; name: string }[] };
type PreviewEntry = Record<string, unknown> & { index: number };

/** Backend preview: every entry new unless `overrides` says otherwise (by index). */
function previewOf(
  body: Body,
  overrides: Record<number, PreviewEntry> = {},
  warnings: unknown[] = [],
) {
  const events = body.events.map((_, index) => overrides[index] ?? { index, status: "new" });
  return {
    events,
    summary: { total: events.length, new: events.length, duplicate: 0, invalid: 0 },
    warnings,
  };
}

function importOf(body: Body, warnings: unknown[] = []) {
  return {
    imported: body.events.length,
    skipped: 0,
    createdLocations: body.locations.map((l, i) => ({ tempId: l.tempId, id: `new-${i}` })),
    ids: body.events.map((_, i) => `e${i}`),
    warnings,
  };
}

const previewCalls = () =>
  apiPost.mock.calls.filter(([p]) => String(p).endsWith("/events/import/preview"));
const importCalls = () => apiPost.mock.calls.filter(([p]) => String(p).endsWith("/events/import"));

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

const place = { id: "l1", clubId: "k1", name: "Schützenhaus Waldblick" };
let calendar: Record<string, unknown>;
let existing: unknown[];

function icsFile(content = ics, name = "plan.ics") {
  return new File([content], name, { type: "text/calendar" });
}
function fileInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026" };
  existing = [];
  apiGet.mockReset();
  apiPost.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path.endsWith("/locations")) return Promise.resolve([place]);
    if (path.endsWith("/properties") || path.endsWith("/features")) return Promise.resolve([]);
    if (path === "/api/calendars/k1/events") return Promise.resolve(existing);
    return Promise.resolve([]);
  });
  apiPost.mockImplementation((path: string, body: Body) => {
    if (path.endsWith("/events/import/preview")) return Promise.resolve(previewOf(body));
    if (path.endsWith("/events/import")) return Promise.resolve(importOf(body));
    return Promise.reject(new Error(`unexpected POST ${path}`));
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

  it("reads umlauts of a UTF-8 file correctly and shows no encoding notice", async () => {
    const user = userEvent.setup();
    const content = ics.replace(/Training Luftgewehr/g, "Schützentraining für Groß und Klein");
    await openReview(user, content);
    expect(
      (await screen.findAllByText(/Schützentraining für Groß und Klein/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Die Datei ist nicht UTF-8-kodiert")).toBeNull();
  });

  it("falls back to windows-1252 for a file that is not UTF-8 and says so in the review", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <ImportPage />);
    await screen.findByRole("heading", { name: "Termine importieren", level: 1 });
    // "Schützenfest" with ü as the single byte 0xFC (windows-1252), invalid as UTF-8.
    const head = new TextEncoder().encode(ics.replace("Herbstfest", "Sch"));
    const marker = new TextEncoder().encode("Sch");
    const at = head.findIndex((_, i) => marker.every((b, k) => head[i + k] === b));
    const bytes = new Uint8Array([
      ...head.slice(0, at + 3),
      0xfc,
      ...new TextEncoder().encode("tzenfest"),
      ...head.slice(at + 3),
    ]);
    await user.upload(fileInput(), new File([bytes], "alt.ics", { type: "text/calendar" }));
    await user.click(await screen.findByRole("button", { name: /Datei prüfen/ }));
    expect((await screen.findAllByText(/Schützenfest/)).length).toBeGreaterThan(0);
    expect(screen.getByText("Die Datei ist nicht UTF-8-kodiert")).toBeInTheDocument();
    expect(screen.getByText(/Windows-1252 gelesen/)).toBeInTheDocument();
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

  it("labels the preset draft status in the bulk panel (design: Entwurf (voreingestellt))", async () => {
    const user = userEvent.setup();
    await openReview(user);
    expect(screen.getByRole("button", { name: "Entwurf (voreingestellt)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("puts the import button before Zurück on phones and after it on desktop", async () => {
    const order = () => {
      const buttons = screen
        .getAllByRole("button")
        .map((b) => b.textContent ?? "")
        .filter((n) => n === "Zurück" || /Termine importieren$/.test(n));
      return buttons;
    };
    const user = userEvent.setup();
    await openReview(user);
    expect(order()).toEqual(["Zurück", "3 Termine importieren"]);

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
      const mobileUser = userEvent.setup();
      cleanup();
      await openReview(mobileUser);
      expect(order()).toEqual(["3 Termine importieren", "Zurück"]);
    } finally {
      window.matchMedia = original;
    }
  });

  it("marks events the backend's preview finds in the calendar and can deselect them", async () => {
    apiPost.mockImplementation((path: string, body: Body) => {
      if (!path.endsWith("/events/import/preview")) return Promise.resolve(importOf(body));
      const index = body.events.findIndex((e) => e.name === "Herbstfest");
      return Promise.resolve(
        previewOf(body, {
          [index]: {
            index,
            status: "duplicate",
            duplicate: { id: "e1", name: "Herbstfest", date: "2026-10-24", rule: "externalUid" },
          },
        }),
      );
    });
    const user = userEvent.setup();
    await openReview(user);
    expect(await screen.findByText("Ein Termin gibt es vielleicht schon")).toBeInTheDocument();
    // The preview gets all events of the file with their UID; the calendar's events are not loaded
    const sent = (previewCalls()[0][1] as Body).events;
    expect(sent.map((e) => e.externalUid)).toEqual(["a", "b", "c"]);
    expect(apiGet).not.toHaveBeenCalledWith("/api/calendars/k1/events");
    await user.click(screen.getByRole("button", { name: "Doppelte abwählen" }));
    expect(screen.getByText("2 von 3 ausgewählt")).toBeInTheDocument();
    // Selection changes do not run the preview again
    expect(previewCalls()).toHaveLength(1);
  });

  it("falls back to comparing name and day in the browser when the preview fails", async () => {
    existing = [{ id: "e1", name: "herbstfest", date: "2026-10-24T00:00:00+00:00" }];
    apiPost.mockImplementation((path: string, body: Body) =>
      path.endsWith("/preview")
        ? Promise.reject(new Error("API error 500"))
        : Promise.resolve(importOf(body)),
    );
    const user = userEvent.setup();
    await openReview(user);
    expect(await screen.findByText("Ein Termin gibt es vielleicht schon")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/calendars/k1/events");
    await user.click(screen.getByRole("button", { name: "Doppelte abwählen" }));
    expect(screen.getByText("2 von 3 ausgewählt")).toBeInTheDocument();
  });

  it("checks again after an edit", async () => {
    const user = userEvent.setup();
    await openReview(user);
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Weitere Termine: Termine anzeigen" }));
    await user.click(screen.getByRole("button", { name: /Termin Herbstfest am .* bearbeiten/ }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Oktoberfest");
    await user.click(within(dialog).getByRole("button", { name: "Änderungen übernehmen" }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    const sent = (previewCalls()[1][1] as Body).events.map((e) => e.name);
    expect(sent).toContain("Oktoberfest");
  });

  it("blocks events the backend would reject until they are deselected", async () => {
    apiPost.mockImplementation((path: string, body: Body) =>
      path.endsWith("/preview")
        ? Promise.resolve(
            previewOf(body, {
              1: {
                index: 1,
                status: "invalid",
                errors: [{ field: "events[1].name", code: "validation_failed", message: "x" }],
              },
            }),
          )
        : Promise.resolve(importOf(body)),
    );
    const user = userEvent.setup();
    await openReview(user);
    expect(
      await screen.findByText("Ein Termin kann so nicht importiert werden"),
    ).toBeInTheDocument();
    expect(screen.getByText("Fehlerhaft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 Termine importieren" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Fehlerhafte abwählen" }));
    expect(screen.getByRole("button", { name: "2 Termine importieren" })).toBeEnabled();
  });

  it("names replaced time zones in the review and in the result", async () => {
    const warning = {
      index: 0,
      field: "timezone",
      code: "timezone_replaced",
      message: 'Unknown time zone "US/Pacific-New" replaced by Europe/Berlin',
      value: "US/Pacific-New",
      replacement: "Europe/Berlin",
    };
    apiPost.mockImplementation((path: string, body: Body) =>
      path.endsWith("/preview")
        ? Promise.resolve(previewOf(body, {}, [warning]))
        : Promise.resolve(importOf(body, [warning])),
    );
    const user = userEvent.setup();
    await openReview(user);
    expect(await screen.findByText("Unbekannte Zeitzone wird ersetzt")).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 Termin nennt eine Zeitzone, die der Kalender nicht kennt (US/Pacific-New). Er wird in der Zeitzone Europe/Berlin angelegt. Prüfe die Uhrzeit nach dem Import.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Zeitzone ersetzt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "3 Termine importieren" }));
    await screen.findByRole("heading", { level: 1, name: "3 Termine importiert" });
    expect(screen.getByText("Bei 1 Termin wurde die Zeitzone ersetzt")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die Datei nannte US/Pacific-New. Angelegt in Europe/Berlin; prüfe die Uhrzeiten.",
      ),
    ).toBeInTheDocument();
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

  it("keeps the visible text in the accessible name of the group's edit button", async () => {
    const user = userEvent.setup();
    await openReview(user);
    const buttons = screen.getAllByRole("button", { name: /^Gruppe bearbeiten/ });
    expect(buttons.length).toBeGreaterThan(0);
    for (const edit of buttons) {
      expect(edit.getAttribute("aria-label")).toContain(edit.textContent);
    }
    expect(
      screen.getByRole("button", { name: "Gruppe bearbeiten: Training Luftgewehr" }),
    ).toBeInTheDocument();
  });

  it("edits a group in the dialog and validates", async () => {
    const user = userEvent.setup();
    await openReview(user);
    await user.click(
      screen.getByRole("button", { name: "Gruppe bearbeiten: Training Luftgewehr" }),
    );
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

  it("closes the edit dialog with Escape and returns focus to its button (shared FormDialog)", async () => {
    const user = userEvent.setup();
    await openReview(user);
    const opener = screen.getByRole("button", {
      name: "Gruppe bearbeiten: Training Luftgewehr",
    });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", {
      name: "Gruppe bearbeiten: Training Luftgewehr",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
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

describe("ImportPage – large groups", () => {
  const many = (n: number) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      ...Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10).replace(/-/g, "");
        return [
          "BEGIN:VEVENT",
          `UID:m${i}`,
          "SUMMARY:Training",
          `DTSTART:${d}T190000`,
          `DTEND:${d}T210000`,
          "END:VEVENT",
        ].join("\r\n");
      }),
      "END:VCALENDAR",
    ].join("\r\n");

  it("renders only the first 100 events of a group, adds more by button and counts all", async () => {
    const user = userEvent.setup();
    await openReview(user, many(230));
    const table = screen.getByRole("table", { name: "Termine der Gruppe Training" });
    expect(within(table).getAllByRole("checkbox", { name: /auswählen$/ })).toHaveLength(100);
    expect(screen.getByText("100 von 230 Terminen angezeigt")).toBeInTheDocument();
    expect(screen.getByText("230 von 230 ausgewählt")).toBeInTheDocument();

    // A change in the visible part counts, the group checkbox covers the hidden events, too.
    await user.click(within(table).getAllByRole("checkbox", { name: /auswählen$/ })[0]);
    expect(screen.getByText("229 von 230 ausgewählt")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /^Training: 229 von 230/ }));
    expect(screen.getByText("230 von 230 ausgewählt")).toBeInTheDocument();

    const more = screen.getByRole("button", { name: "100 weitere Termine anzeigen" });
    await user.click(more);
    expect(within(table).getAllByRole("checkbox", { name: /auswählen$/ })).toHaveLength(200);
    // Focus moves to the first new row
    const rows = within(table).getAllByRole("checkbox", { name: /auswählen$/ });
    expect(rows[100]).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "30 weitere Termine anzeigen" }));
    expect(within(table).getAllByRole("checkbox", { name: /auswählen$/ })).toHaveLength(230);
    expect(screen.getByText("230 von 230 Terminen angezeigt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /weitere Termine anzeigen/ })).toBeNull();
  });
});

describe("ImportPage – import and result", () => {
  it("creates new places, imports only the selected events as drafts and shows the result", async () => {
    const user = userEvent.setup();
    await openReview(user);
    const table = screen.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    await user.click(within(table).getByRole("checkbox", { name: /15\.10\.2026 auswählen/ }));
    await user.click(screen.getByRole("button", { name: "2 Termine importieren" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "2 Termine importiert" });
    expect(heading).toHaveFocus();

    // ONE atomic request with the new place; no separate POST …/locations
    expect(importCalls()).toHaveLength(1);
    expect(apiPost).not.toHaveBeenCalledWith("/api/clubs/c1/locations", expect.anything());
    const body = importCalls()[0][1] as Body & { skipDuplicates: boolean };
    expect(body.skipDuplicates).toBe(false);
    expect(body.locations).toEqual([
      { tempId: "new:gasthof zur linde", name: "Gasthof Zur Linde" },
    ]);
    const sent = body.events;
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => e.name)).toEqual(["Training Luftgewehr", "Herbstfest"]);
    expect(sent[0]).toMatchObject({
      date: "2026-10-08",
      isDraft: true,
      locationId: "l1",
      isAllDay: false,
      externalUid: "a",
    });
    expect(sent[1]).toMatchObject({
      date: "2026-10-24",
      isAllDay: true,
      locationId: null,
      locationTempId: "new:gasthof zur linde",
      externalUid: "c",
    });

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
    apiPost.mockImplementation((path: string, body: Body) =>
      path.endsWith("/events/import")
        ? Promise.reject(new Error("API error 500"))
        : Promise.resolve(previewOf(body)),
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

describe("ImportPage – limit per import", () => {
  const many = (n: number) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      ...Array.from({ length: n }, (_, i) =>
        [
          "BEGIN:VEVENT",
          `UID:e${i}`,
          "SUMMARY:Training",
          `DTSTART;VALUE=DATE:${2027 + Math.floor(i / 336)}${String(1 + (Math.floor(i / 28) % 12)).padStart(2, "0")}${String(1 + (i % 28)).padStart(2, "0")}`,
          "END:VEVENT",
        ].join("\r\n"),
      ),
      "END:VCALENDAR",
    ].join("\r\n");

  it("explains the limit and blocks the import above 5000 selected events", async () => {
    const user = userEvent.setup();
    await openReview(user, many(5001));
    expect(await screen.findByText("Zu viele Termine für einen Import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5001 Termine importieren" })).toBeDisabled();
    // Too large for one preview request: the browser check takes over
    expect(previewCalls()).toHaveLength(0);
    const table = screen.getByRole("table", { name: "Termine der Gruppe Training" });
    await user.click(within(table).getAllByRole("checkbox", { name: /auswählen$/ })[0]);
    expect(screen.queryByText("Zu viele Termine für einen Import")).toBeNull();
    expect(screen.getByRole("button", { name: "5000 Termine importieren" })).toBeEnabled();
  }, 60000);

  it("lists the recurrence limits as a bullet list inside the banner", async () => {
    const user = userEvent.setup();
    const endless = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:e",
      "SUMMARY:Training",
      "DTSTART:20261015T190000",
      "DTEND:20261015T210000",
      "RRULE:FREQ=DAILY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    await openReview(user, endless);
    const banner = (
      await screen.findByText("Nicht alle Wiederholungen wurden ausgeschrieben")
    ).closest(".ap-banner")!;
    const list = within(banner as HTMLElement).getByRole("list");
    // The class carries `list-style: disc` (src/index.css); the base reset would hide the bullets
    expect(list).toHaveClass("ap-banner-list");
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(list.getAttribute("style")).toBeNull();
  });

  it("reports the backend's limit as a failure where nothing was created", async () => {
    const { ApiError } = await import("@/lib/api");
    apiPost.mockImplementation((path: string, body: Body) =>
      path.endsWith("/events/import")
        ? Promise.reject(new ApiError("Maximum 5000 events per import", 413, "too_many_events"))
        : Promise.resolve(previewOf(body)),
    );
    const user = userEvent.setup();
    await openReview(user);
    await user.click(screen.getByRole("button", { name: "3 Termine importieren" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Import fehlgeschlagen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Es lassen sich höchstens 5.000 Termine auf einmal importieren. Es wurden keine Termine angelegt.",
    );
    await user.click(screen.getByRole("button", { name: "Zurück zur Prüfung" }));
    expect(await screen.findByRole("button", { name: "3 Termine importieren" })).toBeEnabled();
  });
});

describe("ImportPage – archived calendar", () => {
  it("does not offer the import", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderRoute(route, url, <ImportPage />);
    expect(await screen.findByText("Kalender archiviert")).toBeInTheDocument();
    expect(fileInput()).toBeNull();
  });
});

describe("ImportPage – recurrences", () => {
  const recurringIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:tr@verein",
    "SUMMARY:Training",
    "DTSTART;TZID=Europe/Berlin:20261005T190000",
    "DTEND;TZID=Europe/Berlin:20261005T210000",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:x@verein",
    "SUMMARY:Sitzung",
    "DTSTART:20261007T190000",
    "RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:e@verein",
    "SUMMARY:Stammtisch",
    "DTSTART;VALUE=DATE:20261001",
    "RRULE:FREQ=WEEKLY",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("expands rules into single events with hints, warnings and one UID per instance", async () => {
    const user = userEvent.setup();
    await openReview(user, recurringIcs);

    // 3 Training + 1 Sitzung + 105 Stammtisch (two years)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("109 Termine erkannt");
    expect(screen.getByText("Wiederholungen ausgeschrieben")).toBeVisible();
    expect(screen.getByText(/2 Wiederholungen ergeben 108 einzelne Termine/)).toHaveTextContent(
      "nicht als Terminreihe",
    );
    expect(
      screen.getByText(
        "Wiederholung wird nicht unterstützt: nur der erste Termin wird importiert.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/1 Wiederholung hat kein Ende/)).toHaveTextContent(
      "ersten zwei Jahre, höchstens 366",
    );
    expect(screen.getByText(/3 Termine · Wiederholung \(3 Termine\)/)).toBeVisible();

    await waitFor(() => expect(previewCalls().length).toBeGreaterThan(0));
    const body = previewCalls().at(-1)![1] as Body;
    const uids = body.events.map((e) => e.externalUid);
    expect(uids).toEqual(
      expect.arrayContaining([
        "tr@verein#20261005",
        "tr@verein#20261012",
        "tr@verein#20261019",
        "x@verein",
        "e@verein#20261001",
      ]),
    );
    expect(new Set(uids).size).toBe(uids.length);
  });
});
