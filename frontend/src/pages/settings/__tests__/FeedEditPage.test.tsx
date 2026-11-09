import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedEditPage from "../FeedEditPage";
import {
  CLUB_BASE,
  CLUB_CALENDARS_PATH,
  CLUB_PATTERN,
  renderRoute,
} from "../../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const apiGetWithTotal = vi.fn();

vi.mock("@/lib/api", () => ({
  BACKEND_URL: "https://api.example.org",
  ApiError: class ApiError extends Error {},
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiGetWithTotal: (...a: unknown[]) => apiGetWithTotal(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

const feedsPath = "/api/clubs/c1/feeds";
const q = "?includeSecret=1";
const calendars = [
  { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: null },
  {
    id: "k2",
    clubId: "c1",
    name: "Saison 2025",
    timezone: null,
    archivedAt: "2026-01-01T00:00:00+00:00",
  },
];
let feeds: unknown[];

const privateFeed = {
  id: "f2",
  clubId: "c1",
  calendarIds: ["k1"],
  name: "Vorstand intern",
  visibility: "PRIVATE",
  indexable: false,
  sharedSecret: "test-secret-value",
  targetGroups: [{ feedId: "f2", targetGroupId: "g1" }],
};

const feedMembers = [
  {
    userId: "u1",
    name: "Anna Beispiel",
    email: "anna@example.org",
    source: "assigned",
    createdAt: "",
  },
  { userId: "u2", name: "Ben Muster", email: "ben@example.org", source: "claimed", createdAt: "" },
];
const candidates = [{ id: "u3", name: "Carla Neu", email: "carla@example.org", role: "member" }];

function renderEdit(feedId?: string) {
  const path = feedId
    ? `${CLUB_PATTERN}/settings/feeds/:feedId`
    : `${CLUB_PATTERN}/settings/feeds/new`;
  const url = `${CLUB_BASE}/settings/feeds/${feedId ?? "new"}`;
  return renderRoute(path, url, <FeedEditPage />);
}

beforeEach(() => {
  feeds = [privateFeed];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete, apiGetWithTotal]) fn.mockReset();
  apiGetWithTotal.mockImplementation((path: string) => {
    if (path.startsWith(`${feedsPath}/f2/members?`))
      return Promise.resolve({ data: feedMembers, total: feedMembers.length });
    if (path.startsWith("/api/clubs/c1/members?"))
      return Promise.resolve({ data: candidates, total: candidates.length });
    return Promise.resolve({ data: [], total: 0 });
  });
  mockApiGet(apiGet, (path: string) => {
    if (path === CLUB_CALENDARS_PATH) return Promise.resolve(calendars);
    if (path === `${feedsPath}${q}`) return Promise.resolve(feeds);
    // Single GET of the edit page; unknown ids are a 404 like in the backend
    if (path.startsWith(`${feedsPath}/`)) {
      const feed = (feeds as { id: string }[]).find((f) => path === `${feedsPath}/${f.id}${q}`);
      return feed
        ? Promise.resolve(feed)
        : Promise.reject(Object.assign(new Error("API error 404"), { status: 404 }));
    }
    if (path === "/api/clubs/c1/target-groups")
      return Promise.resolve([
        { id: "g1", name: "Jugend" },
        { id: "g2", name: "Erwachsene" },
      ]);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({ id: "f9" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

describe("FeedEditPage (new)", () => {
  it("starts club internal and explains where the addresses appear", async () => {
    renderEdit();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed anlegen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Nur per Link/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Öffentlich/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /^Privat \(geschützt\)/ })).not.toBeChecked();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      screen.getByText(/erscheint hier, sobald du den Feed gespeichert hast/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Geheimnis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feed löschen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zurück zu Veröffentlichen" })).toHaveAttribute(
      "href",
      `${CLUB_BASE}/settings/feeds`,
    );
  });

  it("requires a name: error summary links to the field and nothing is sent", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.click(await screen.findByRole("button", { name: "Feed speichern" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte gib einen Namen für den Feed ein.");
    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription(/Bitte gib einen Namen/);
    await user.click(
      within(alert).getByRole("link", { name: "Bitte gib einen Namen für den Feed ein." }),
    );
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("lists all calendars (archived ones marked, with a hint) and preselects the active ones", async () => {
    renderEdit();
    const group = await screen.findByRole("group", { name: /^Kalender/ });
    expect(within(group).getByRole("button", { name: "Schießbetrieb 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(group).getByRole("button", { name: "Saison 2025 (archiviert)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(group).toHaveAccessibleDescription(/Archivierte Kalender liefern keine Termine/);
  });

  it("requires at least one calendar: message, summary link, nothing is sent", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "Termine");
    await user.click(await screen.findByRole("button", { name: "Schießbetrieb 2026" }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte wähle mindestens einen Kalender für den Feed.");
    expect(screen.getByRole("group", { name: /^Kalender/ })).toHaveAccessibleDescription(
      /Bitte wähle mindestens einen Kalender/,
    );
    await user.click(
      within(alert).getByRole("link", {
        name: "Bitte wähle mindestens einen Kalender für den Feed.",
      }),
    );
    expect(document.getElementById("fe-calendars-chips")).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("sends the chosen calendars, archived ones included", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "Beide");
    await user.click(await screen.findByRole("button", { name: "Saison 2025 (archiviert)" }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        `${feedsPath}${q}`,
        expect.objectContaining({ calendarIds: ["k1", "k2"] }),
      ),
    );
  });

  it("maps a 422 on calendarIds to the calendar field", async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("x"), {
        status: 422,
        code: "unknown_reference",
        field: "calendarIds",
      }),
    );
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "Termine");
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Die Auswahl der Kalender wurde abgelehnt");
    expect(alert).not.toHaveTextContent("konnte nicht gespeichert werden");
    expect(screen.getByRole("group", { name: /^Kalender/ })).toHaveAccessibleDescription(
      /Auswahl der Kalender wurde abgelehnt/,
    );
  });

  it("offers three states in one radio group, each with an explanation", async () => {
    renderEdit();
    const group = await screen.findByRole("group", { name: "Sichtbarkeit" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["PUBLIC", "CLUB", "PRIVATE"]);
    expect(new Set(radios.map((r) => (r as HTMLInputElement).name)).size).toBe(1);
    expect(within(group).getByRole("radio", { name: /^Nur per Link/ })).toHaveAccessibleName(
      /Suchmaschinen listen ihn nicht auf/,
    );
    // "Nur per Link" is no access restriction: the text must say that anyone with the link sees it
    expect(within(group).getByRole("radio", { name: /^Nur per Link/ })).toHaveAccessibleName(
      /Kein Zugriffsschutz: Jeder mit dem Link .* auch Nicht-Mitglieder/,
    );
    expect(within(group).getByRole("radio", { name: /^Öffentlich/ })).toHaveAccessibleName(
      /Jeder mit dem Link kann den Kalender ansehen/,
    );
    expect(within(group).getByRole("radio", { name: /^Privat/ })).toHaveAccessibleName(
      /Nur mit dem Geheimnis im Link/,
    );
  });

  it("has no search engine switch and saves a public feed", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "Termine");
    await user.click(screen.getByRole("radio", { name: /^Öffentlich/ }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}${q}`, {
        name: "Termine",
        visibility: "PUBLIC",
        calendarIds: ["k1"],
        targetGroupIds: [],
      }),
    );
  });

  it("creates a club internal feed by default", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "Mitglieder");
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}${q}`, {
        name: "Mitglieder",
        visibility: "CLUB",
        calendarIds: ["k1"],
        targetGroupIds: [],
      }),
    );
  });

  it("creates a private feed limited to audiences and opens its addresses in the list", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "  Jugend-Abo ");
    await user.click(screen.getByRole("radio", { name: /Privat/ }));
    await user.click(await screen.findByRole("button", { name: "Jugend" }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}${q}`, {
        name: "Jugend-Abo",
        visibility: "PRIVATE",
        calendarIds: ["k1"],
        targetGroupIds: ["g1"],
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(`${CLUB_BASE}/settings/feeds`);
  });

  it("shows an error and keeps the input when saving fails", async () => {
    apiPost.mockRejectedValue(new Error("x"));
    const user = userEvent.setup();
    renderEdit();
    const name = await screen.findByLabelText(/^Name/);
    await user.type(name, "Test{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Feed konnte nicht gespeichert werden.",
    );
    expect(name).toHaveValue("Test");
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("toggles audiences with aria-pressed", async () => {
    const user = userEvent.setup();
    renderEdit();
    const chip = await screen.findByRole("button", { name: "Erwachsene" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Ohne Auswahl enthält der Feed alle Gruppen.")).toBeInTheDocument();
  });
});

describe("FeedEditPage (edit)", () => {
  it("fills the form and shows the secret and the page link of the saved feed", async () => {
    renderEdit("f2");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed bearbeiten" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Vorstand intern");
    expect(screen.getByRole("radio", { name: /^Privat/ })).toBeChecked();
    expect(await screen.findByRole("button", { name: "Jugend" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Erwachsene" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("heading", { name: "Geheimnis" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Geheimnis" })).toHaveValue(
      "•".repeat("test-secret-value".length),
    );
    expect(screen.getByLabelText("Adresse der Webansicht")).toHaveValue(
      `${window.location.origin}/feed/f2?secret=test-secret-value`,
    );
    expect(screen.queryByLabelText("ICS-Adresse")).not.toBeInTheDocument();
  });

  it("saves changes with a PATCH", async () => {
    const user = userEvent.setup();
    renderEdit("f2");
    const name = await screen.findByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Vorstand");
    await user.click(screen.getByRole("button", { name: "Jugend" }));
    await user.click(screen.getByRole("button", { name: "Erwachsene" }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(`${feedsPath}/f2${q}`, {
        name: "Vorstand",
        visibility: "PRIVATE",
        calendarIds: ["k1"],
        targetGroupIds: ["g2"],
      }),
    );
  });

  it("asks before a private feed becomes reachable without the secret", async () => {
    const user = userEvent.setup();
    renderEdit("f2");
    await user.click(await screen.findByRole("radio", { name: /^Nur per Link/ }));
    // The secret panel describes the saved feed until it is saved
    expect(screen.getByRole("heading", { name: "Geheimnis" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Geheimnis nicht mehr verlangen?",
    });
    expect(dialog).toHaveTextContent("„Vorstand intern“ wird auf „Nur per Link“ gestellt.");
    expect(dialog).toHaveTextContent(
      "Danach kann jeder mit dem Link den Kalender sehen, auch wer den bisherigen Link mit Geheimnis nicht kennt.",
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus(),
    );
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /^Öffentlich/ }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    const again = await screen.findByRole("alertdialog");
    expect(again).toHaveTextContent("„Vorstand intern“ wird öffentlich.");
    await user.click(within(again).getByRole("button", { name: "Ohne Geheimnis speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(`${feedsPath}/f2${q}`, {
        name: "Vorstand intern",
        visibility: "PUBLIC",
        calendarIds: ["k1"],
        targetGroupIds: ["g1"],
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(`${CLUB_BASE}/settings/feeds`);
  });

  it("does not ask when a feed without secret changes its status", async () => {
    feeds = [{ ...privateFeed, visibility: "CLUB", targetGroups: [] }];
    const user = userEvent.setup();
    renderEdit("f2");
    await user.click(await screen.findByRole("radio", { name: /^Öffentlich/ }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(`${feedsPath}/f2${q}`, {
        name: "Vorstand intern",
        visibility: "PUBLIC",
        calendarIds: ["k1"],
        targetGroupIds: [],
      }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("regenerates the secret only after confirming the consequence", async () => {
    const user = userEvent.setup();
    renderEdit("f2");
    await user.click(await screen.findByRole("button", { name: "Geheimnis neu erzeugen" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Geheimnis neu erzeugen?" });
    expect(dialog).toHaveTextContent(
      "Der Feed „Vorstand intern“ bekommt ein neues Geheimnis und damit neue Adressen.",
    );
    expect(dialog).toHaveTextContent("Bestehende Abonnements werden unterbrochen.");
    expect(apiPost).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(apiPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Geheimnis neu erzeugen" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Geheimnis neu erzeugen",
      }),
    );
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/regenerate-secret${q}`, {}),
    );
  });

  it("deletes after confirming and leaves for the list", async () => {
    const user = userEvent.setup();
    renderEdit("f2");
    await user.click(await screen.findByRole("button", { name: "Feed löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Feed „Vorstand intern“ löschen?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Feed löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`${feedsPath}/f2`));
    expect(await screen.findByTestId("location")).toHaveTextContent(`${CLUB_BASE}/settings/feeds`);
  });

  it.each(["PUBLIC", "CLUB"])("has no secret panel for a %s feed", async (visibility) => {
    feeds = [{ ...privateFeed, visibility, targetGroups: [] }];
    renderEdit("f2");
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByRole("heading", { name: "Geheimnis" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Geheimnis neu erzeugen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Adresse der Webansicht")).toHaveValue(
      `${window.location.origin}/feed/f2`,
    );
  });

  it("explains an unknown feed", async () => {
    renderEdit("nope");
    expect(await screen.findByRole("heading", { name: "Feed nicht gefunden" })).toBeInTheDocument();
  });

  it("loads the feed with the single GET, not the list", async () => {
    renderEdit("f2");
    await screen.findByLabelText(/^Name/);
    const paths = apiGet.mock.calls.map(([path]) => path);
    expect(paths).toContain(`${feedsPath}/f2${q}`);
    expect(paths).not.toContain(`${feedsPath}${q}`);
  });

  it("offers a retry when the feed cannot be loaded", async () => {
    const fallback = apiGet.getMockImplementation()!;
    mockApiGet(apiGet, (path: string) =>
      path === `${feedsPath}/f2${q}`
        ? Promise.reject(Object.assign(new Error("API error 500"), { status: 500 }))
        : fallback(path),
    );
    renderEdit("f2");
    expect(await screen.findByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("is read-only for editors (no archived state at club level)", async () => {
    mockApiGet(
      apiGet,
      (path: string) =>
        path === `${feedsPath}/f2${q}` ? Promise.resolve(privateFeed) : Promise.resolve([]),
      "editor",
    );
    renderEdit("f2");
    expect(await screen.findByText(/Nur Vereins-Admins können Feeds/)).toBeInTheDocument();
    expect(screen.queryByText("Archiviert, schreibgeschützt")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Feed speichern" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feed löschen" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Geheimnis neu erzeugen" }),
    ).not.toBeInTheDocument();
  });

  it("shows the forbidden state to viewers", async () => {
    mockApiGet(apiGet, () => Promise.resolve([]), "viewer");
    renderEdit("f2");
    expect(
      await screen.findByRole("heading", { name: "Feeds sind für deine Rolle nicht verfügbar" }),
    ).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith(`${feedsPath}/f2${q}`);
  });
});

describe("FeedEditPage (new, roles)", () => {
  it("keeps editors out of the create page", async () => {
    mockApiGet(apiGet, () => Promise.resolve([]), "editor");
    renderEdit();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Keine Berechtigung" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feed speichern" })).not.toBeInTheDocument();
  });
});

describe("FeedEditPage assignments and rotation", () => {
  it("lists assigned members with their source and removes one after confirming", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ removed: 1 });
    renderEdit("f2");
    const heading = await screen.findByRole("heading", { name: /Zugewiesene Mitglieder/ });
    expect(heading).toBeInTheDocument();
    expect(await screen.findByText("Anna Beispiel")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Zugewiesen")).toBeInTheDocument();
    expect(table.getByText("Selbst übernommen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anna Beispiel entfernen" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Zugriff entfernen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/members/bulk-delete`, {
        userIds: ["u1"],
      }),
    );
  });

  it("removes the selection in one request and searches on the server", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ removed: 2 });
    renderEdit("f2");
    await screen.findByText("Anna Beispiel");
    await user.click(screen.getByRole("checkbox", { name: "Anna Beispiel auswählen" }));
    await user.click(screen.getByRole("checkbox", { name: "Ben Muster auswählen" }));
    await user.click(screen.getByRole("button", { name: "Auswahl entfernen (2)" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Zugriff entfernen",
      }),
    );
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/members/bulk-delete`, {
        userIds: ["u1", "u2"],
      }),
    );

    await user.type(
      screen.getByRole("searchbox", { name: "Zugewiesene Mitglieder durchsuchen" }),
      "ben",
    );
    await waitFor(() =>
      expect(apiGetWithTotal).toHaveBeenCalledWith(
        expect.stringContaining("members?page=1&perPage=10&q=ben"),
        expect.anything(),
      ),
    );
  });

  it("adds members found by the server-side search", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ added: 1 });
    renderEdit("f2");
    await user.click(await screen.findByRole("button", { name: "Hinzufügen" }));
    await user.click(await screen.findByRole("checkbox", { name: /Carla Neu/ }));
    await user.click(screen.getByRole("button", { name: "1 Person hinzufügen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/members`, { userIds: ["u3"] }),
    );
  });

  it("adds an e-mail list (deduplicated) and shows the unknown addresses", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ added: 1, unknown: ["fremd@example.org"] });
    renderEdit("f2");
    await user.click(await screen.findByRole("button", { name: "Hinzufügen" }));
    await user.click(screen.getByRole("button", { name: "E-Mail-Liste einfügen" }));
    await user.type(
      screen.getByRole("textbox", { name: /E-Mail-Adressen/ }),
      "Anna@example.org, anna@example.org; fremd@example.org",
    );
    await user.click(screen.getByRole("button", { name: "2 Adressen hinzufügen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/members/by-email`, {
        emails: ["anna@example.org", "fremd@example.org"],
      }),
    );
    expect(await screen.findByText("fremd@example.org")).toBeInTheDocument();
  });

  it("offers to withdraw claimed access when rotating the secret", async () => {
    const user = userEvent.setup();
    renderEdit("f2");
    await user.click(await screen.findByRole("button", { name: "Geheimnis neu erzeugen" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /selbst übernommen haben/ }));
    await user.click(within(dialog).getByRole("button", { name: "Geheimnis neu erzeugen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/regenerate-secret${q}`, {
        revokeClaimed: true,
      }),
    );
  });

  it("hides the section for feeds that are not private", async () => {
    feeds = [{ ...privateFeed, visibility: "CLUB" }];
    renderEdit("f2");
    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.queryByRole("heading", { name: /Zugewiesene Mitglieder/ }),
    ).not.toBeInTheDocument();
  });
});
