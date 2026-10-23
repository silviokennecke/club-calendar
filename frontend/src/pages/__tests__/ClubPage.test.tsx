import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClubPage from "../ClubPage";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";
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
  role: "admin",
};
let invitations: unknown[];
let members: { id: string; name: string; email: string; role: string }[];
let clubRole: string;
let calendars: Record<string, unknown>[];
let clubError: Error | null;
let clubList: unknown[];

function renderClub(tab?: "general" | "calendars" | "members") {
  return renderRoute("/clubs/:clubId", `/clubs/c1${tab ? `?tab=${tab}` : ""}`, <ClubPage />);
}

beforeEach(() => {
  members = [
    { id: "u1", name: "Alex Beispiel", email: "alex@beispiel.de", role: "admin" },
    { id: "u2", name: "Mara Sommer", email: "mara@beispiel.de", role: "editor" },
  ];
  calendars = [
    { id: "k1", name: "Schießbetrieb 2026", timezone: null, eventCount: 12 },
    { id: "k2", name: "Jugend", timezone: "Europe/Vienna", eventCount: 1 },
    {
      id: "k0",
      name: "Saison 2025",
      archivedAt: "2026-01-15T10:00:00+00:00",
      eventCount: 1,
      feedCount: 1,
      exclusiveFeedCount: 0,
    },
  ];
  invitations = [];
  clubRole = "admin";
  clubError = null;
  clubList = [club];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete, updateUser]) fn.mockReset();
  updateUser.mockResolvedValue(true);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs") return Promise.resolve(clubList);
    if (path === "/api/clubs/c1")
      return clubError ? Promise.reject(clubError) : Promise.resolve({ ...club, role: clubRole });
    if (path === "/api/clubs/c1/members") return Promise.resolve(members);
    if (path === "/api/clubs/c1/invitations") return Promise.resolve(invitations);
    // Single GET (delete dialog): fresh counters
    if (path === "/api/clubs/c1/calendars/k2")
      return Promise.resolve({
        ...calendars[1],
        eventCount: 3,
        feedCount: 3,
        exclusiveFeedCount: 1,
      });
    if (path.startsWith("/api/clubs/c1/calendars")) return Promise.resolve(calendars);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({ id: "new", name: "Copy of Schießbetrieb 2026" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClubPage", () => {
  it("shows name and zone on the general tab; members and calendars on their own tabs", async () => {
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
    expect(screen.getByRole("tab", { name: "Allgemeines", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists members on the members tab", async () => {
    renderClub("members");
    expect(await screen.findByRole("tab", { name: "Mitglieder", selected: true })).toBeVisible();
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
  });

  it("switches tabs and lists calendars incl. archived on the calendars tab", async () => {
    renderClub();
    await userEvent.click(await screen.findByRole("tab", { name: "Kalender" }));
    expect(screen.queryByLabelText(/^Name des Vereins/)).not.toBeInTheDocument();
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
    renderClub("general");
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

  it("invites by e-mail with a neutral message and clears the field", async () => {
    const success = vi.spyOn(toast, "success");
    const user = userEvent.setup();
    renderClub("members");
    await user.type(await screen.findByLabelText(/^E-Mail-Adresse/), "jonas@beispiel.de");
    await user.click(screen.getByRole("button", { name: "Einladung senden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/invitations", {
        email: "jonas@beispiel.de",
        role: "editor",
      }),
    );
    await waitFor(() => expect(screen.getByLabelText(/^E-Mail-Adresse/)).toHaveValue(""));
    // never says whether the address has an account
    expect(success).toHaveBeenCalledWith(
      "Wenn jonas@beispiel.de eingeladen werden kann, wurde eine Einladung verschickt.",
    );
    expect(apiPost).not.toHaveBeenCalledWith("/api/clubs/c1/members", expect.anything());
  });

  it("explains invalid and duplicate addresses, quota and rate limits", async () => {
    const user = userEvent.setup();
    renderClub("members");
    const field = await screen.findByLabelText(/^E-Mail-Adresse/);
    const send = screen.getByRole("button", { name: "Einladung senden" });

    await user.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib eine E-Mail-Adresse ein.",
    );

    await user.type(field, "kein-mail");
    await user.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib eine gültige E-Mail-Adresse ein.",
    );

    await user.clear(field);
    await user.type(field, "MARA@beispiel.de");
    await user.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diese Person ist schon Mitglied im Verein.",
    );
    expect(apiPost).not.toHaveBeenCalled();

    apiPost.mockRejectedValue(new ApiError("x", 422, "quota_exceeded"));
    await user.clear(field);
    await user.type(field, "viele@beispiel.de");
    await user.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent("so viele Einladungen offen");
    expect(field).toHaveAccessibleDescription(/so viele Einladungen offen/);
    expect(field).toHaveValue("viele@beispiel.de");

    apiPost.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    await user.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Einladungen");
  });

  it("lists open invitations: both can be sent again", async () => {
    invitations = [
      {
        id: "i1",
        email: "offen@beispiel.de",
        status: "pending",
        invitedByName: "Alex Beispiel",
        createdAt: "2026-10-10T10:00:00+00:00",
        expiresAt: "2026-10-24T10:00:00+00:00",
      },
      {
        id: "i2",
        email: "alt@beispiel.de",
        status: "expired",
        invitedByName: null,
        createdAt: "2026-09-01T10:00:00+00:00",
        expiresAt: "2026-09-15T10:00:00+00:00",
      },
    ];
    const user = userEvent.setup();
    renderClub("members");
    const table = await screen.findByRole("table", { name: "Offene Einladungen (2)" });
    const pending = within(within(table).getByText("offen@beispiel.de").closest("tr")!);
    expect(pending.getByText("Offen bis 24.10.2026")).toBeInTheDocument();
    expect(
      pending.getByRole("button", { name: "Einladung an offen@beispiel.de erneut senden" }),
    ).toBeInTheDocument();
    const expired = within(within(table).getByText("alt@beispiel.de").closest("tr")!);
    expect(expired.getByText("Abgelaufen")).toBeInTheDocument();
    await user.click(
      expired.getByRole("button", { name: "Einladung an alt@beispiel.de erneut senden" }),
    );
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/invitations/i2/resend", {}),
    );
  });

  it("shows a toast when sending again is rate limited", async () => {
    invitations = [
      {
        id: "i1",
        email: "offen@beispiel.de",
        status: "pending",
        invitedByName: null,
        createdAt: "2026-10-10T10:00:00+00:00",
        expiresAt: "2026-10-24T10:00:00+00:00",
      },
    ];
    apiPost.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    const error = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    renderClub("members");
    await user.click(
      await screen.findByRole("button", { name: "Einladung an offen@beispiel.de erneut senden" }),
    );
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("Zu viele")));
  });

  it("revokes an invitation only after confirming", async () => {
    invitations = [
      {
        id: "i1",
        email: "offen@beispiel.de",
        status: "pending",
        invitedByName: null,
        createdAt: "2026-10-10T10:00:00+00:00",
        expiresAt: "2026-10-24T10:00:00+00:00",
      },
    ];
    const user = userEvent.setup();
    renderClub("members");
    await user.click(
      await screen.findByRole("button", { name: "Einladung an offen@beispiel.de widerrufen" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Einladung an offen@beispiel.de widerrufen?",
    });
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Einladung widerrufen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/invitations/i1"));
  });

  it("shows no invitation list without open invitations", async () => {
    renderClub("members");
    await screen.findByLabelText(/^E-Mail-Adresse/);
    expect(screen.queryByRole("heading", { name: "Offene Einladungen" })).not.toBeInTheDocument();
  });

  it("removes a member only after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderClub("members");
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

  it("disables leaving for the only member and explains why", async () => {
    members = [members[0]];
    renderClub("members");
    expect(await screen.findByRole("button", { name: /Verein .* verlassen/ })).toBeDisabled();
    expect(screen.getByText(/Du bist das einzige Mitglied/)).toBeInTheDocument();
  });

  it("explains a refused removal of the last member (422 last_member)", async () => {
    apiDelete.mockRejectedValue(new ApiError("last", 422, "last_member"));
    const error = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    renderClub("members");
    await user.click(await screen.findByRole("button", { name: "Mara Sommer entfernen" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Mitglied entfernen",
      }),
    );
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining("letzte Mitglied")),
    );
  });

  it("treats a member someone else removed meanwhile (404 member_not_found) as removed", async () => {
    apiDelete.mockRejectedValue(new ApiError("Member not found", 404, "member_not_found"));
    const success = vi.spyOn(toast, "success");
    const error = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    renderClub("members");
    await user.click(await screen.findByRole("button", { name: "Mara Sommer entfernen" }));
    members = [members[0]];
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Mitglied entfernen",
      }),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Mara Sommer wurde aus dem Verein entfernt."),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Mara Sommer entfernen" }),
      ).not.toBeInTheDocument(),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("reports other failures of removing a member", async () => {
    apiDelete.mockRejectedValue(new ApiError("Forbidden", 403));
    const error = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    renderClub("members");
    await user.click(await screen.findByRole("button", { name: "Mara Sommer entfernen" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Mitglied entfernen",
      }),
    );
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "Das Mitglied konnte nicht entfernt werden. Bitte versuche es erneut.",
      ),
    );
  });

  it("leaving the club removes yourself and goes to the club picker", async () => {
    const user = userEvent.setup();
    renderClub("members");
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
    renderClub("calendars");
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
    renderClub("calendars");
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
    renderClub("calendars");
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
    renderClub("calendars");
    await user.click(await screen.findByRole("button", { name: "Kalender Jugend löschen" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Kalender „Jugend“ löschen?" });
    expect(dialog).toHaveTextContent("Der Kalender wird dauerhaft gelöscht.");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Löscht den Kalender mit allen 3 Terminen unwiderruflich. 1 Feed, der nur diesen Kalender enthält, wird mit gelöscht; seine Adressen funktionieren danach nicht mehr. 2 weitere Feeds verlieren diesen Kalender, bleiben aber bestehen.",
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
    renderClub("calendars");
    await user.click(await screen.findByRole("button", { name: "Kalender Saison 2025 löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Archivierten Kalender „Saison 2025“ löschen?",
    });
    expect(dialog).toHaveTextContent("Der archivierte Kalender wird dauerhaft gelöscht.");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Löscht Saison 2025 mit allen Terminen unwiderruflich. Eine Wiederherstellung ist danach nicht mehr möglich. 1 weiterer Feed verliert diesen Kalender, bleibt aber bestehen.",
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
          : path === "/api/clubs/c1/invitations"
            ? Promise.resolve([])
            : Promise.resolve(path === "/api/clubs" ? clubList : calendars),
    );
    const user = userEvent.setup();
    renderClub("general");
    await user.click(await screen.findByRole("button", { name: "Verein löschen" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Löscht den Verein, alle Kalender, Termine, Feeds und Vorlagen unwiderruflich. Alle Mitglieder verlieren den Zugriff.",
    );
  });

  it("deletes the club only after typing its name", async () => {
    const user = userEvent.setup();
    renderClub("general");
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
    renderClub("members");
    expect(
      await screen.findByText("Die Mitglieder konnten nicht geladen werden."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Die offenen Einladungen konnten nicht geladen werden."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Erneut versuchen" })).toHaveLength(2);
    await userEvent.click(screen.getByRole("tab", { name: "Kalender" }));
    expect(
      await screen.findByText("Die Kalender konnten nicht geladen werden."),
    ).toBeInTheDocument();
  });

  it("admin sees roles as selects, changes one and invites with a role", async () => {
    const user = userEvent.setup();
    renderClub("members");
    const select = await screen.findByLabelText("Rolle von Mara Sommer");
    expect(select).toHaveValue("editor");
    await user.selectOptions(select, "viewer");
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/clubs/c1/members/u2", { role: "viewer" }),
    );

    await user.type(await screen.findByLabelText(/^E-Mail-Adresse/), "neu@beispiel.de");
    await user.selectOptions(screen.getByLabelText("Rolle", { selector: "select" }), "admin");
    await user.click(screen.getByRole("button", { name: "Einladung senden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/invitations", {
        email: "neu@beispiel.de",
        role: "admin",
      }),
    );
  });

  it("explains last_admin when changing a role is refused", async () => {
    const error = vi.spyOn(toast, "error");
    apiPatch.mockRejectedValue(new ApiError("x", 422, "last_admin"));
    const user = userEvent.setup();
    renderClub("members");
    await user.selectOptions(await screen.findByLabelText("Rolle von Alex Beispiel"), "viewer");
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining("einzige Admin")),
    );
  });

  it("non-admins see roles read-only, no invite form and cannot remove others", async () => {
    clubRole = "editor";
    renderClub("members");
    const table = await screen.findByRole("table", { name: "Mitglieder des Vereins (2)" });
    expect(within(table).getByText("Bearbeiter")).toBeInTheDocument();
    expect(within(table).getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rolle von Mara Sommer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mara Sommer entfernen" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verein Schützenverein Waldblick verlassen" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Einladung senden" })).not.toBeInTheDocument();
  });
});
