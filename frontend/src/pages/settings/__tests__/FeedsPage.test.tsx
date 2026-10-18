import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedsPage from "../FeedsPage";
import {
  CLUB_BASE,
  CLUB_CALENDARS_PATH,
  CLUB_PATTERN,
  renderRoute,
} from "../../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", () => ({
  BACKEND_URL: "https://api.example.org",
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: vi.fn(),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

const route = `${CLUB_PATTERN}/settings/feeds`;
const url = `${CLUB_BASE}/settings/feeds`;
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

const publicFeed = {
  id: "f1",
  calendarId: "k1",
  name: "Öffentlicher Kalender",
  visibility: "PUBLIC",
  searchable: false,
  indexable: false,
  sharedSecret: "s-public",
  targetGroups: [],
};
const privateFeed = {
  id: "f2",
  calendarId: "k1",
  name: "Vorstand intern",
  visibility: "PRIVATE",
  searchable: false,
  indexable: false,
  sharedSecret: "test-secret-value",
  targetGroups: [{ feedId: "f2", targetGroupId: "g1" }],
};

beforeEach(() => {
  feeds = [publicFeed, privateFeed];
  for (const fn of [apiGet, apiPost, apiDelete]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === CLUB_CALENDARS_PATH) return Promise.resolve(calendars);
    if (path === "/api/clubs/c1/feeds?includeSecret=1") return Promise.resolve(feeds);
    if (path === "/api/clubs/c1/target-groups")
      return Promise.resolve([
        { id: "g1", name: "Jugend" },
        { id: "g2", name: "Erwachsene" },
      ]);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

describe("FeedsPage", () => {
  it("lists feeds with visibility as word and icon, audiences and a count", async () => {
    renderRoute(route, url, <FeedsPage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Veröffentlichen" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Schützenverein · 2 Feeds")).toBeInTheDocument();
    const pub = screen.getByRole("region", { name: "Öffentlicher Kalender" });
    expect(within(pub).getByText("Öffentlich")).toBeInTheDocument();
    expect(within(pub).getByText("Alle Gruppen")).toBeInTheDocument();
    const priv = screen.getByRole("region", { name: "Vorstand intern" });
    expect(within(priv).getByText("Privat")).toBeInTheDocument();
    expect(
      within(priv).getByRole("group", { name: "Gruppen von Vorstand intern" }),
    ).toHaveTextContent("Jugend");
    // No emoji icons for the visibility.
    expect(pub.textContent).not.toMatch(/[\u{1F310}\u{1F512}]/u);
  });

  it("shows each of the three states as word and icon and marks findable public feeds", async () => {
    const user = userEvent.setup();
    feeds = [
      { ...publicFeed, id: "f3", name: "Auffindbar", searchable: true, indexable: true },
      { ...publicFeed, id: "f4", name: "Vereinskalender", visibility: "CLUB", sharedSecret: "s-c" },
      publicFeed,
      privateFeed,
    ];
    renderRoute(route, url, <FeedsPage />);
    const badges = (name: string) =>
      Array.from(
        screen.getByRole("region", { name }).querySelectorAll<HTMLElement>(".ap-badge"),
      ).map((b) => [b.dataset.status, b.textContent, !!b.querySelector("svg")]);

    await screen.findByRole("region", { name: "Vereinskalender" });
    expect(badges("Auffindbar")).toEqual([
      ["public", "Öffentlich", true],
      ["searchable", "Auffindbar", true],
    ]);
    expect(badges("Vereinskalender")).toEqual([["club", "Nur per Link", true]]);
    expect(badges("Öffentlicher Kalender")).toEqual([["public", "Öffentlich", true]]);
    expect(badges("Vorstand intern")).toEqual([["private", "Privat", true]]);

    // Club internal: addresses without the secret, no secret field
    const club = screen.getByRole("region", { name: "Vereinskalender" });
    await user.click(within(club).getByRole("button", { name: "Zugänge anzeigen" }));
    expect(within(club).getByLabelText("ICS-Adresse")).toHaveValue(
      "https://api.example.org/api/feed/f4/ics",
    );
    expect(within(club).getByLabelText("Adresse der Webansicht")).toHaveValue(
      `${window.location.origin}/feed/f4`,
    );
    expect(within(club).queryByLabelText("Geheimnis")).not.toBeInTheDocument();
  });

  it("opens the first feed's addresses by default and toggles the others", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <FeedsPage />);
    const pub = await screen.findByRole("region", { name: "Öffentlicher Kalender" });
    const hide = within(pub).getByRole("button", { name: "Zugänge verbergen" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(within(pub).getByLabelText("ICS-Adresse")).toHaveValue(
      "https://api.example.org/api/feed/f1/ics",
    );
    expect(within(pub).getByLabelText("Abo-Adresse (webcal)")).toHaveValue(
      "webcal://api.example.org/api/feed/f1/ics",
    );
    expect(within(pub).getByLabelText("Adresse der Webansicht")).toHaveValue(
      `${window.location.origin}/feed/f1`,
    );
    expect(within(pub).queryByLabelText("Geheimnis")).not.toBeInTheDocument();

    const priv = screen.getByRole("region", { name: "Vorstand intern" });
    expect(within(priv).queryByLabelText("ICS-Adresse")).not.toBeInTheDocument();
    await user.click(within(priv).getByRole("button", { name: "Zugänge anzeigen" }));
    // The secret is masked (and the toggle says so) until it is revealed.
    const secret = within(priv).getByLabelText("Geheimnis");
    expect(secret).toHaveValue("•".repeat("test-secret-value".length));
    expect(within(priv).getByLabelText("ICS-Adresse")).toHaveValue(
      "https://api.example.org/api/feed/f2/ics?secret=test-secret-value",
    );
    await user.click(within(priv).getByRole("button", { name: "Geheimnis anzeigen" }));
    expect(secret).toHaveValue("test-secret-value");
    expect(
      within(priv).getByText(/Wer das Geheimnis kennt, kann den Feed lesen/),
    ).toBeInTheDocument();
  });

  it("announces a copied address", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderRoute(route, url, <FeedsPage />);
    const pub = await screen.findByRole("region", { name: "Öffentlicher Kalender" });
    const ics = within(pub).getByLabelText("ICS-Adresse").closest(".ap-stack") as HTMLElement;
    await user.click(within(ics).getByRole("button", { name: "Kopieren" }));
    expect(writeText).toHaveBeenCalledWith("https://api.example.org/api/feed/f1/ics");
    expect(await within(ics).findByRole("status")).toHaveTextContent(
      "ICS-Adresse wurde in die Zwischenablage kopiert.",
    );
  });

  it("links to the create and edit pages", async () => {
    renderRoute(route, url, <FeedsPage />);
    await screen.findByRole("link", { name: "Feed „Vorstand intern“ bearbeiten" });
    const links = screen.getAllByRole("link", { name: "Feed anlegen" });
    for (const l of links) expect(l).toHaveAttribute("href", `${CLUB_BASE}/settings/feeds/new`);
    expect(screen.getByRole("link", { name: "Feed „Vorstand intern“ bearbeiten" })).toHaveAttribute(
      "href",
      `${CLUB_BASE}/settings/feeds/f2`,
    );
    expect(screen.getByRole("link", { name: "Kalender exportieren" })).toHaveAttribute(
      "href",
      "/clubs/c1/calendars/k1/events/export",
    );
  });

  it("deletes a feed only after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <FeedsPage />);
    await user.click(await screen.findByRole("button", { name: "Feed „Vorstand intern“ löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Feed „Vorstand intern“ löschen?",
    });
    expect(dialog).toHaveTextContent("Wer den Feed abonniert hat, bekommt keine Updates mehr.");
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Feed löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/feeds/f2"));
  });

  it("cancelling the delete dialog deletes nothing", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <FeedsPage />);
    await user.click(await screen.findByRole("button", { name: "Feed „Vorstand intern“ löschen" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Abbrechen" }),
    );
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it("shows the empty state with the way to create a feed", async () => {
    feeds = [];
    renderRoute(route, url, <FeedsPage />);
    expect(await screen.findByRole("heading", { name: "Noch kein Feed" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Feed anlegen" }).length).toBeGreaterThan(0);
  });

  it("shows an error with retry when the feeds cannot be loaded", async () => {
    const user = userEvent.setup();
    mockApiGet(apiGet, () => Promise.reject(new Error("API error 500")));
    renderRoute(route, url, <FeedsPage />);
    expect(await screen.findByText("Die Feeds konnten nicht geladen werden.")).toBeInTheDocument();
    mockApiGet(apiGet, () => Promise.resolve([]));
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("heading", { name: "Noch kein Feed" })).toBeInTheDocument();
  });

  it("has the club settings tabs and no archived state", async () => {
    renderRoute(route, url, <FeedsPage />);
    await screen.findByRole("heading", { level: 1, name: "Veröffentlichen" });
    const tabs = screen.getByRole("navigation", { name: "Einstellungen des Vereins" });
    await within(tabs).findByRole("link", { name: "Feeds" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Orte", "Gruppen", "Feeds"]);
    expect(within(tabs).getByRole("link", { name: "Feeds" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Schützenverein", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Archiviert, schreibgeschützt")).not.toBeInTheDocument();
  });

  it("is read-only for editors: addresses visible, no create, edit or delete", async () => {
    mockApiGet(
      apiGet,
      (path: string) =>
        path === "/api/clubs/c1/feeds?includeSecret=1"
          ? Promise.resolve(feeds)
          : Promise.resolve([]),
      "editor",
    );
    renderRoute(route, url, <FeedsPage />);
    expect(await screen.findByText(/Nur Vereins-Admins können Feeds/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Feed anlegen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /bearbeiten/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /löschen/ })).not.toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: /Zugänge/ })).length).toBe(2);
  });

  it("shows the forbidden state to viewers and loads no feeds", async () => {
    mockApiGet(apiGet, () => Promise.resolve([]), "viewer");
    renderRoute(route, url, <FeedsPage />);
    expect(
      await screen.findByRole("heading", { name: "Feeds sind für deine Rolle nicht verfügbar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zurück zum Verein" })).toHaveAttribute(
      "href",
      "/clubs/c1",
    );
    expect(apiGet).not.toHaveBeenCalledWith("/api/clubs/c1/feeds?includeSecret=1");
  });
});
