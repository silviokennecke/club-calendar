import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClubPage from "../ClubPage";
import { renderRoute } from "../events/__tests__/testUtils";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", dateFormat: "dd.MM.yyyy" }, updateUser }),
}));

// Counters of GET /api/clubs/:id (delete dialog) and of the calendar list (rows, delete dialog)
const club = {
  id: "c1",
  name: "Schützenverein Waldblick",
  timezone: "Europe/Berlin",
  calendarCount: 2,
  archivedCalendarCount: 1,
  memberCount: 2,
  eventCount: 14,
  feedCount: 2,
};
let members: { id: string; name: string; email: string }[];
let calendars: Record<string, unknown>[];
let clubError: Error | null;
let clubList: unknown[];

function renderClub() {
  return renderRoute("/clubs/:clubId", "/clubs/c1", <ClubPage />);
}

beforeEach(() => {
  members = [
    { id: "u1", name: "Alex Beispiel", email: "alex@beispiel.de" },
    { id: "u2", name: "Mara Sommer", email: "mara@beispiel.de" },
  ];
  calendars = [
    { id: "k1", name: "Schießbetrieb 2026", timezone: null, eventCount: 12 },
    { id: "k2", name: "Jugend", timezone: "Europe/Vienna", eventCount: 1 },
    { id: "k0", name: "Saison 2025", archivedAt: "2026-01-15T10:00:00+00:00", eventCount: 1 },
  ];
  clubError = null;
  clubList = [club];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete, updateUser]) fn.mockReset();
  updateUser.mockResolvedValue(true);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs") return Promise.resolve(clubList);
    if (path === "/api/clubs/c1")
      return clubError ? Promise.reject(clubError) : Promise.resolve(club);
    if (path === "/api/clubs/c1/members") return Promise.resolve(members);
    // Single GET (delete dialog): fresh counters
    if (path === "/api/clubs/c1/calendars/k2")
      return Promise.resolve({ ...calendars[1], eventCount: 3 });
    if (path.startsWith("/api/clubs/c1/calendars")) return Promise.resolve(calendars);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({ id: "new", name: "Copy of Schießbetrieb 2026" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

describe("ClubPage", () => {
  it("shows name, zone, members, calendars and archived calendars", async () => {
    renderClub();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Verein verwalten" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Schützenverein Waldblick · Zeitzone Europe/Berlin"),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Name des Vereins/)).toHaveValue(
      "Schützenverein Waldblick",
    );

    const table = await screen.findByRole("table", { name: "Mitglieder des Vereins (2)" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    // The current user is marked in words and can leave; others can be removed.
    expect(within(rows[1]).getByText("Du")).toBeInTheDocument();
    expect(
      within(rows[1]).getByRole("button", { name: "Verein Schützenverein Waldblick verlassen" }),
    ).toBeInTheDocument();
    expect(
      within(rows[2]).getByRole("button", { name: "Mara Sommer entfernen" }),
    ).toBeInTheDocument();

    // Rows name the number of events (design: Club "n Termine"), not the zone
    expect(await screen.findByText("12 Termine")).toBeInTheDocument();
    expect(screen.getByText("1 Termin")).toBeInTheDocument();
    expect(screen.queryByText("Zeitzone Europe/Vienna")).not.toBeInTheDocument();
    const archived = screen.getByRole("list", { name: "Archivierte Kalender" });
    expect(within(archived).getByText("Saison 2025")).toBeInTheDocument();
    expect(within(archived).getByText("Archiviert", { selector: ".ap-badge" })).toBeInTheDocument();
    expect(within(archived).getByText("Archiviert am 15.01.2026")).toBeInTheDocument();
    expect(
      within(archived).getByRole("link", { name: "Kalender Saison 2025 ansehen" }),
    ).toHaveAttribute("href", "/clubs/c1/calendars/k0");
  });

  it("renames the club and validates an empty name", async () => {
    const user = userEvent.setup();
    renderClub();
    const name = await screen.findByLabelText(/^Name des Vereins/);
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Namen speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib einen Namen für den Verein ein.",
    );
    expect(apiPatch).not.toHaveBeenCalled();
    await user.type(name, "  Neuer Name{Enter}");
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/clubs/c1", { name: "Neuer Name" }),
    );
  });

  it("adds a member by e-mail and clears the field", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.type(await screen.findByLabelText(/^E-Mail-Adresse/), "jonas@beispiel.de");
    await user.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/members", { email: "jonas@beispiel.de" }),
    );
    await waitFor(() => expect(screen.getByLabelText(/^E-Mail-Adresse/)).toHaveValue(""));
  });

  it("explains invalid, duplicate and unknown e-mail addresses", async () => {
    const user = userEvent.setup();
    renderClub();
    const field = await screen.findByLabelText(/^E-Mail-Adresse/);
    const add = screen.getByRole("button", { name: "Mitglied hinzufügen" });

    await user.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib eine E-Mail-Adresse ein.",
    );

    await user.type(field, "kein-mail");
    await user.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib eine gültige E-Mail-Adresse ein.",
    );

    await user.clear(field);
    await user.type(field, "MARA@beispiel.de");
    await user.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diese Person ist schon Mitglied im Verein.",
    );
    expect(apiPost).not.toHaveBeenCalled();

    apiPost.mockRejectedValue(Object.assign(new Error("User not found"), { status: 404 }));
    await user.clear(field);
    await user.type(field, "niemand@beispiel.de");
    await user.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Zu dieser E-Mail-Adresse gibt es kein Konto.",
    );
    expect(field).toHaveAccessibleDescription(/kein Konto/);
    expect(field).toHaveValue("niemand@beispiel.de");
  });

  it("removes a member only after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(await screen.findByRole("button", { name: "Mara Sommer entfernen" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Mara Sommer entfernen?" });
    expect(dialog).toHaveTextContent("Ihr Konto bleibt bestehen.");
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(apiDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Mara Sommer entfernen" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Mitglied entfernen",
      }),
    );
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/members/u2"));
  });

  it("leaving the club removes yourself and goes to the club picker", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(
      await screen.findByRole("button", { name: "Verein Schützenverein Waldblick verlassen" }),
    );
    const dialog = await screen.findByRole("alertdialog", { name: "Verein verlassen?" });
    await user.click(within(dialog).getByRole("button", { name: "Verein verlassen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/members/u1"));
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs?select=1");
    expect(updateUser).toHaveBeenCalledWith({ lastClubId: null, lastCalendarId: null });
  });

  it("creates a calendar from the inline form and stays on the page", async () => {
    const user = userEvent.setup();
    renderClub();
    const toggle = await screen.findByRole("button", { name: "Kalender anlegen", expanded: false });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const form = screen.getByRole("form", { name: "Kalender anlegen" });
    await user.click(within(form).getByRole("button", { name: "Kalender anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib einen Namen für den Kalender ein.",
    );
    await user.type(within(form).getByLabelText(/^Name des Kalenders/), "Schießbetrieb 2027");
    await user.click(within(form).getByRole("button", { name: "Kalender anlegen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/calendars", {
        name: "Schießbetrieb 2027",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Kalender anlegen" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("duplicates a calendar, names the copy and stays on the page", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(
      await screen.findByRole("button", { name: "Kalender Schießbetrieb 2026 duplizieren" }),
    );
    // The localized name goes with the POST (no rename afterwards)
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/calendars/k1/duplicate", {
        name: "Kopie von Schießbetrieb 2026",
      }),
    );
    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("archives after confirming and restores an archived calendar", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(await screen.findByRole("button", { name: "Kalender Jugend archivieren" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Kalender „Jugend“ archivieren?",
    });
    expect(dialog).toHaveTextContent(
      "Der Kalender wandert in die Liste der archivierten Kalender.",
    );
    expect(dialog).toHaveTextContent(
      "Der Kalender ist danach gesperrt: Niemand kann Termine anlegen, ändern oder löschen.",
    );
    expect(apiPost).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Kalender archivieren" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/calendars/k2/archive", {}),
    );

    await user.click(screen.getByRole("button", { name: "Archivierung von Saison 2025 aufheben" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/calendars/k0/unarchive", {}),
    );
  });

  it("deletes a calendar after confirming and names what is lost", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(await screen.findByRole("button", { name: "Kalender Jugend löschen" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Kalender „Jugend“ löschen?" });
    expect(dialog).toHaveTextContent("Der Kalender wird dauerhaft gelöscht.");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Löscht den Kalender mit allen 3 Terminen und seinen Feeds unwiderruflich. Die Adressen der Feeds funktionieren danach nicht mehr.",
      ),
    );
    // Counted by the backend: no event list is loaded
    expect(apiGet.mock.calls.some(([path]) => String(path).endsWith("/events"))).toBe(false);
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Kalender löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/calendars/k2"));
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("uses its own wording for deleting an archived calendar (no restore afterwards)", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(await screen.findByRole("button", { name: "Kalender Saison 2025 löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Archivierten Kalender „Saison 2025“ löschen?",
    });
    expect(dialog).toHaveTextContent("Der archivierte Kalender wird dauerhaft gelöscht.");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Löscht Saison 2025 mit allen Terminen und Feeds unwiderruflich. Eine Wiederherstellung ist danach nicht mehr möglich.",
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "Kalender löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/calendars/k0"));
  });

  it("names the club scope in general words while the counters are unknown", async () => {
    clubList = [club];
    const { eventCount: _events, feedCount: _feeds, ...withoutCounts } = club;
    apiGet.mockImplementation((path: string) =>
      path === "/api/clubs/c1"
        ? Promise.resolve(withoutCounts)
        : path === "/api/clubs/c1/members"
          ? Promise.resolve(members)
          : Promise.resolve(path === "/api/clubs" ? clubList : calendars),
    );
    const user = userEvent.setup();
    renderClub();
    await user.click(await screen.findByRole("button", { name: "Verein löschen" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Löscht den Verein, alle Kalender, Termine, Feeds und Vorlagen unwiderruflich. Alle Mitglieder verlieren den Zugriff.",
    );
  });

  it("deletes the club only after typing its name", async () => {
    const user = userEvent.setup();
    renderClub();
    await user.click(await screen.findByRole("button", { name: "Verein löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Verein „Schützenverein Waldblick“ löschen?",
    });
    // Scope from the club's counters (all calendars incl. archived ones)
    expect(dialog).toHaveTextContent(
      "Löscht den Verein mit 3 Kalendern, 14 Terminen und 2 Feeds sowie allen Vorlagen unwiderruflich. Alle Mitglieder verlieren den Zugriff.",
    );
    const confirm = within(dialog).getByRole("button", { name: "Verein löschen" });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Vereinsname zur Bestätigung eingeben"),
      "Schützenverein",
    );
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Vereinsname zur Bestätigung eingeben"),
      " Waldblick",
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1"));
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
  });

  it("explains an unknown club (404, or not in my list when the status is unreadable)", async () => {
    clubError = new Error("Failed to fetch");
    clubList = [];
    renderClub();
    expect(
      await screen.findByRole("heading", { name: "Verein nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Zu allen Vereinen" })).toHaveLength(2);
  });

  it("offers a retry when the club cannot be loaded", async () => {
    clubError = new Error("API error 500");
    const user = userEvent.setup();
    renderClub();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Verein konnte nicht geladen werden.",
    );
    clubError = null;
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByLabelText(/^Name des Vereins/)).toBeInTheDocument();
  });

  it("shows errors of the member and calendar lists separately", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/api/clubs/c1") return Promise.resolve(club);
      return Promise.reject(new Error("API error 500"));
    });
    renderClub();
    expect(
      await screen.findByText("Die Mitglieder konnten nicht geladen werden."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Die Kalender konnten nicht geladen werden."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Erneut versuchen" })).toHaveLength(2);
  });
});
