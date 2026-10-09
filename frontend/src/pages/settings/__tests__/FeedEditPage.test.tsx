import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedEditPage from "../FeedEditPage";
import { BASE, PATTERN, renderRoute } from "../../events/__tests__/testUtils";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", () => ({
  BACKEND_URL: "https://api.example.org",
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

const feedsPath = "/api/calendars/k1/feeds";
let calendar: Record<string, unknown>;
let feeds: unknown[];

const privateFeed = {
  id: "f2",
  calendarId: "k1",
  name: "Vorstand intern",
  visibility: "PRIVATE",
  sharedSecret: "test-secret-value",
  targetGroups: [{ feedId: "f2", targetGroupId: "g1" }],
};

function renderEdit(feedId?: string) {
  const path = feedId ? `${PATTERN}/settings/feeds/:feedId` : `${PATTERN}/settings/feeds/new`;
  const url = `${BASE}/settings/feeds/${feedId ?? "new"}`;
  return renderRoute(path, url, <FeedEditPage />);
}

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: null };
  feeds = [privateFeed];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path === feedsPath) return Promise.resolve(feeds);
    // Single GET of the edit page; unknown ids are a 404 like in the backend
    if (path.startsWith(`${feedsPath}/`)) {
      const feed = (feeds as { id: string }[]).find((f) => path === `${feedsPath}/${f.id}`);
      return feed
        ? Promise.resolve(feed)
        : Promise.reject(Object.assign(new Error("API error 404"), { status: 404 }));
    }
    if (path === "/api/calendars/k1/target-groups")
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
  it("starts public and explains where the addresses appear", async () => {
    renderEdit();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed anlegen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Öffentlich/ })).toBeChecked();
    expect(
      screen.getByText(/erscheinen hier, sobald du den Feed gespeichert hast/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Geheimnis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feed löschen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zurück zu Veröffentlichen" })).toHaveAttribute(
      "href",
      `${BASE}/settings/feeds`,
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

  it("creates a private feed limited to audiences and opens its addresses in the list", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(await screen.findByLabelText(/^Name/), "  Jugend-Abo ");
    await user.click(screen.getByRole("radio", { name: /Privat/ }));
    await user.click(await screen.findByRole("button", { name: "Jugend" }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(feedsPath, {
        name: "Jugend-Abo",
        visibility: "PRIVATE",
        targetGroupIds: ["g1"],
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}/settings/feeds`);
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
    expect(screen.getByText("Ohne Auswahl enthält der Feed alle Zielgruppen.")).toBeInTheDocument();
  });
});

describe("FeedEditPage (edit)", () => {
  it("fills the form and shows the secret and the three addresses of the saved feed", async () => {
    renderEdit("f2");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed bearbeiten" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Vorstand intern");
    expect(screen.getByRole("radio", { name: /Privat/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Jugend" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Erwachsene" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("heading", { name: "Geheimnis" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Geheimnis" })).toHaveValue(
      "•".repeat("test-secret-value".length),
    );
    expect(screen.getByLabelText("ICS-Adresse")).toHaveValue(
      "https://api.example.org/api/feed/f2/ics?secret=test-secret-value",
    );
    expect(screen.getByLabelText("Abo-Adresse (webcal)")).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse der Webansicht")).toBeInTheDocument();
  });

  it("saves changes with a PATCH", async () => {
    const user = userEvent.setup();
    renderEdit("f2");
    const name = await screen.findByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Vorstand");
    await user.click(screen.getByRole("button", { name: "Jugend" }));
    await user.click(screen.getByRole("button", { name: "Erwachsene" }));
    await user.click(screen.getByRole("radio", { name: /Öffentlich/ }));
    await user.click(screen.getByRole("button", { name: "Feed speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(`${feedsPath}/f2`, {
        name: "Vorstand",
        visibility: "PUBLIC",
        targetGroupIds: ["g2"],
      }),
    );
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
      expect(apiPost).toHaveBeenCalledWith(`${feedsPath}/f2/regenerate-secret`, {}),
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
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}/settings/feeds`);
  });

  it("has no secret panel for a public feed", async () => {
    feeds = [{ ...privateFeed, visibility: "PUBLIC", targetGroups: [] }];
    renderEdit("f2");
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByRole("heading", { name: "Geheimnis" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("ICS-Adresse")).toHaveValue(
      "https://api.example.org/api/feed/f2/ics",
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
    expect(paths).toContain(`${feedsPath}/f2`);
    expect(paths).not.toContain(feedsPath);
  });

  it("offers a retry when the feed cannot be loaded", async () => {
    const fallback = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path === `${feedsPath}/f2`
        ? Promise.reject(Object.assign(new Error("API error 500"), { status: 500 }))
        : fallback(path),
    );
    renderEdit("f2");
    expect(await screen.findByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    renderEdit("f2");
    expect(await screen.findByText("Archiviert, schreibgeschützt")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Feed speichern" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feed löschen" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Geheimnis neu erzeugen" }),
    ).not.toBeInTheDocument();
  });
});
