import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import FeedPage from "../FeedPage";
import PublicEventPage from "../PublicEventPage";
import { ThemeProvider } from "@/lib/ThemeProvider";

vi.mock("@/components/feed/PublicEventMap", () => ({
  default: ({ label }: { label: string }) => <div data-testid="map" aria-label={label} />,
}));

const SECRET = "test-secret-value";

const youth = { id: "tg-j", name: "Jugend" };
const adults = { id: "tg-e", name: "Erwachsene" };

function event(partial: Record<string, unknown>) {
  return {
    timeBegin: "19:00",
    timeEnd: "21:00",
    isAllDay: false,
    isDraft: false,
    timezone: "Europe/Berlin",
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
    dateEnd: null,
    ...partial,
  };
}

const feedEvents = [
  event({ id: "e1", name: "Training Luftgewehr", date: "2026-10-08" }),
  event({
    id: "e2",
    name: "Jugendtraining",
    date: "2026-10-08",
    timeBegin: "18:00",
    timeEnd: "19:30",
    targetGroups: [{ targetGroup: youth }],
  }),
  event({
    id: "e3",
    name: "Herbstfest",
    date: "2026-10-24",
    timeBegin: "15:00",
    timeEnd: "22:00",
    location: {
      id: "l1",
      name: "Vereinsheim Mitte",
      street: "Marktplatz 5",
      zip: "12345",
      city: "Musterstadt",
      latitude: 50.5,
      longitude: 8.25,
    },
    properties: [{ property: { id: "p1", name: "Draußen", icon: "🌳" } }],
    features: [{ feature: { id: "f1", name: "Getränkeverkauf" } }],
    targetGroups: [{ targetGroup: youth }, { targetGroup: adults }],
  }),
];

let respond: (url: string) => Response | Promise<Response>;
const fetchMock = vi.fn((url: string) => Promise.resolve(respond(url)));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/feed/:feedId" element={<FeedPage />} />
            <Route path="/feed/:feedId/events/:eventId" element={<PublicEventPage />} />
          </Routes>
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  respond = () => json({ feed: { id: "f1", name: "Schießbetrieb 2026" }, events: feedEvents });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head
    .querySelectorAll("meta[name=referrer], meta[name=robots]")
    .forEach((m) => m.remove());
});

describe("FeedPage", () => {
  it("shows a loading state first, then the feed with header, switches and footer", async () => {
    renderAt("/feed/f1");
    expect(screen.getByRole("status")).toHaveTextContent("Kalender wird geladen.");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Alle Uhrzeiten gelten in der Zeitzone Europe/Berlin."),
    ).toBeInTheDocument();
    // no app shell, no login
    expect(screen.queryByRole("navigation", { name: "Bereiche" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zum Inhalt springen" })).toHaveAttribute(
      "href",
      "#main",
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Darstellung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deutsch" })).toBeInTheDocument();
    expect(screen.getByText("Bereitgestellt mit Club Calendar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Oktober 2026" })).toBeInTheDocument();
    // subscribe
    const sub = screen.getByRole("link", { name: "Kalender abonnieren" });
    expect(sub.getAttribute("href")).toMatch(/^webcal:\/\/.*\/api\/feed\/f1\/ics$/);
    expect(screen.getByRole("link", { name: "Als ICS-Datei laden" })).toHaveAttribute("download");
    expect(document.title).toBe("Schießbetrieb 2026 – Öffentlicher Kalender");
  });

  it("requests without credentials and never leaks the secret into title or referrer", async () => {
    renderAt(`/feed/f1?secret=${SECRET}`);
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`secret=${SECRET}`);
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(document.title).not.toContain(SECRET);
    expect(document.head.querySelector("meta[name=referrer]")).toHaveAttribute(
      "content",
      "no-referrer",
    );
    expect(document.head.querySelector("meta[name=robots]")).toHaveAttribute(
      "content",
      expect.stringContaining("noindex"),
    );
    // the subscribe address carries the secret (that is its purpose)
    expect(
      screen.getByRole("link", { name: "Kalender abonnieren" }).getAttribute("href"),
    ).toContain(`secret=${SECRET}`);
  });

  it("is indexable without a secret", async () => {
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    expect(document.head.querySelector("meta[name=robots]")).toBeNull();
    expect(document.head.querySelector("meta[name=referrer]")).toHaveAttribute(
      "content",
      "no-referrer",
    );
  });

  it("marks today in the calendar's zone, not the browser's", async () => {
    // 2026-10-03 23:30 UTC is already 04.10. in Berlin
    vi.setSystemTime(new Date("2026-10-03T23:30:00Z"));
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    const grid = screen.getByRole("grid");
    expect(within(grid).getByLabelText(/^4\. Oktober, heute/)).toBeInTheDocument();
    expect(within(grid).queryByLabelText(/^3\. Oktober, heute/)).not.toBeInTheDocument();
  });

  it("shows the empty state when no event is published", async () => {
    respond = () => json({ feed: { id: "f1", name: "Leer" }, events: [] });
    renderAt("/feed/f1");
    expect(
      await screen.findByRole("heading", { name: "Noch keine Termine veröffentlicht" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kalender abonnieren" })).toBeInTheDocument();
  });

  it("explains a private feed (403) with a heading and no calendar", async () => {
    respond = () => json({ detail: "Invalid or missing secret" }, 403);
    renderAt("/feed/f1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Dieser Kalender ist privat" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Der Link ist unvollständig oder nicht mehr gültig/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(document.head.querySelector("meta[name=robots]")).toHaveAttribute(
      "content",
      expect.stringContaining("noindex"),
    );
  });

  it("explains an unknown feed (404)", async () => {
    respond = () => json({ detail: "Feed not found" }, 404);
    renderAt("/feed/nope");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Kalender nicht gefunden" }),
    ).toBeInTheDocument();
  });

  it("shows a load error with retry and recovers", async () => {
    let fail = true;
    respond = () =>
      fail ? json({}, 500) : json({ feed: { id: "f1", name: "Wieder da" }, events: feedEvents });
    renderAt("/feed/f1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Kalender konnte nicht geladen werden.",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Kalender nicht verfügbar" }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Wieder da" })).toBeInTheDocument();
  });

  it("treats a network failure like a load error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    renderAt("/feed/f1");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("filters by audience, counts the month and passes the choice to the subscription", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    expect(screen.getByText("Zeige 3 von 3 Terminen")).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Erwachsene" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Zeige 1 von 3 Terminen")).toBeInTheDocument();
    expect(screen.getByText("Dein Abo übernimmt diese Auswahl.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Kalender abonnieren" }).getAttribute("href"),
    ).toContain("targetGroupIds=tg-e");
    expect(screen.getByTestId("location")).toHaveTextContent("groups=tg-e");
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(screen.getByText("Zeige 3 von 3 Terminen")).toBeInTheDocument();
  });

  it("searches by name and offers a way out when nothing matches", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    await user.type(screen.getByRole("searchbox", { name: "Termine suchen" }), "herbst");
    expect(screen.getByText("Zeige 1 von 3 Terminen")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Termine suchen" }));
    await user.type(screen.getByRole("searchbox", { name: "Termine suchen" }), "xyz");
    expect(
      screen.getByRole("heading", { name: "Keine Termine zu „xyz“ gefunden" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Auswahl zurücksetzen" }));
    expect(screen.getByText("Zeige 3 von 3 Terminen")).toBeInTheDocument();
  });

  it("navigates months and says so when a month has no events", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    await user.click(screen.getByRole("button", { name: "Nächster Monat" }));
    expect(screen.getByRole("heading", { level: 2, name: "November 2026" })).toBeInTheDocument();
    expect(
      screen.getByText("In diesem Monat gibt es keine veröffentlichten Termine."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Heute" }));
    expect(screen.getByRole("heading", { level: 2, name: "Oktober 2026" })).toBeInTheDocument();
  });

  it("switches to the list of the month and opens an event page that keeps the secret", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt(`/feed/f1?secret=${SECRET}`);
    await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" });
    await user.click(screen.getByRole("button", { name: "Liste" }));
    const list = screen.getByRole("region", { name: "Termine im Oktober 2026" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    // published only: no status badge on the public page
    expect(within(list).queryByText("Veröffentlicht")).not.toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Herbstfest" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Herbstfest" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/feed/f1/events/e3?secret=${SECRET}`);
    // the way back keeps view and secret
    await user.click(screen.getByRole("link", { name: "Zurück zum Kalender" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Schießbetrieb 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`secret=${SECRET}`);
    expect(screen.getByTestId("location")).toHaveTextContent("view=list");
  });
});

describe("PublicEventPage", () => {
  it("shows date, time, place with map and its text alternative, tags and add-to-calendar", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => (created.push(b as Blob), "blob:test");
    URL.revokeObjectURL = () => undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1/events/e3");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Herbstfest" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sa 24.10.2026")).toBeInTheDocument();
    expect(screen.getByText("15:00 bis 22:00 Uhr")).toBeInTheDocument();
    const place = screen.getByRole("region", { name: "Ort" });
    expect(within(place).getByText("Vereinsheim Mitte")).toBeInTheDocument();
    expect(within(place).getByText(/Marktplatz 5, 12345 Musterstadt/)).toBeInTheDocument();
    expect(await within(place).findByTestId("map")).toHaveAccessibleName(
      "Karte mit Markierung für Vereinsheim Mitte",
    );
    const maps = within(place).getByRole("link", { name: "In Karten-App öffnen" });
    expect(maps).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(maps.getAttribute("href")).toContain("openstreetmap.org");
    const props = screen.getByRole("region", { name: "Eigenschaften" });
    expect(within(props).getByText("Draußen")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Features" })).getByText("Getränkeverkauf"),
    ).toBeInTheDocument();
    const aud = screen.getByRole("region", { name: "Zielgruppen" });
    expect(within(aud).getByText("Jugend")).toBeInTheDocument();
    expect(within(aud).getByText("Erwachsene")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zum Kalender hinzufügen" }));
    expect(created).toHaveLength(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });
    expect(text).toContain("UID:event-e3@club-calendar");
    expect(text).toContain("SUMMARY:🌳 Herbstfest");
    click.mockRestore();
  });

  it("renders names as text, never as markup", async () => {
    respond = () =>
      json({
        feed: { id: "f1", name: "<img src=x onerror=alert(1)>" },
        events: [event({ id: "x1", name: "<b>fett</b>", date: "2026-10-08" })],
      });
    renderAt("/feed/f1/events/x1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "<b>fett</b>" }),
    ).toBeInTheDocument();
    expect(document.querySelector("main b")).toBeNull();
    expect(document.querySelector("img[src=x]")).toBeNull();
  });

  it("explains an unknown or unpublished event and leads back", async () => {
    renderAt(`/feed/f1/events/unbekannt?secret=${SECRET}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Termin nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zurück zum Kalender" })).toHaveAttribute(
      "href",
      `/feed/f1?secret=${SECRET}`,
    );
  });

  it("shows the private state for a missing secret", async () => {
    respond = () => json({}, 403);
    renderAt("/feed/f1/events/e1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Dieser Kalender ist privat" }),
    ).toBeInTheDocument();
  });

  it("shows multi-day and all-day events as a period", async () => {
    respond = () =>
      json({
        feed: { id: "f1", name: "F" },
        events: [
          event({
            id: "m1",
            name: "Pokalschießen",
            date: "2026-10-10",
            dateEnd: "2026-10-11",
            isAllDay: true,
          }),
        ],
      });
    renderAt("/feed/f1/events/m1");
    await screen.findByRole("heading", { level: 1, name: "Pokalschießen" });
    expect(screen.getByText("Sa 10.10.2026 bis So 11.10.2026")).toBeInTheDocument();
    expect(screen.getByText("Ganztägig")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ort" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("map")).not.toBeInTheDocument());
  });
});
