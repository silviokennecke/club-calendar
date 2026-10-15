import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedsPage from "../FeedsPage";
import { BASE, PATTERN, renderRoute } from "../../events/__tests__/testUtils";

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

const route = `${PATTERN}/settings/feeds`;
const url = `${BASE}/settings/feeds`;
let calendar: Record<string, unknown>;
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
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: null };
  feeds = [publicFeed, privateFeed];
  for (const fn of [apiGet, apiPost, apiDelete]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path === "/api/calendars/k1/feeds?includeSecret=1") return Promise.resolve(feeds);
    if (path === "/api/calendars/k1/target-groups")
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
    expect(await screen.findByText("Schießbetrieb 2026 · 2 Feeds")).toBeInTheDocument();
    const pub = screen.getByRole("region", { name: "Öffentlicher Kalender" });
    expect(within(pub).getByText("Öffentlich")).toBeInTheDocument();
    expect(within(pub).getByText("Alle Zielgruppen")).toBeInTheDocument();
    const priv = screen.getByRole("region", { name: "Vorstand intern" });
    expect(within(priv).getByText("Privat")).toBeInTheDocument();
    expect(
      within(priv).getByRole("group", { name: "Zielgruppen von Vorstand intern" }),
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
    for (const l of links) expect(l).toHaveAttribute("href", `${BASE}/settings/feeds/new`);
    expect(screen.getByRole("link", { name: "Feed „Vorstand intern“ bearbeiten" })).toHaveAttribute(
      "href",
      `${BASE}/settings/feeds/f2`,
    );
    expect(screen.getByRole("link", { name: "Kalender exportieren" })).toHaveAttribute(
      "href",
      `${BASE}/events/export`,
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
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/feeds/f2"));
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
    apiGet.mockImplementation((path: string) =>
      path === "/api/clubs/c1/calendars/k1"
        ? Promise.resolve(calendar)
        : Promise.reject(new Error("API error 500")),
    );
    renderRoute(route, url, <FeedsPage />);
    expect(await screen.findByText("Die Feeds konnten nicht geladen werden.")).toBeInTheDocument();
    apiGet.mockImplementation((path: string) =>
      path === "/api/clubs/c1/calendars/k1" ? Promise.resolve(calendar) : Promise.resolve([]),
    );
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("heading", { name: "Noch kein Feed" })).toBeInTheDocument();
  });

  it("is read-only in an archived calendar and offers to restore it", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    const user = userEvent.setup();
    renderRoute(route, url, <FeedsPage />);
    expect(await screen.findByText("Archiviert, schreibgeschützt")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Feed anlegen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /bearbeiten/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /löschen/ })).not.toBeInTheDocument();
    // The addresses can still be looked up.
    expect(screen.getAllByRole("button", { name: /Zugänge/ }).length).toBe(2);
    await user.click(screen.getByRole("button", { name: "Archivierung aufheben" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/calendars/k1/unarchive", {}),
    );
  });
});
