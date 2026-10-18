import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, useLocation } from "react-router-dom";
import FeedPage from "../FeedPage";
import PublicEventModal from "../PublicEventModal";
import { BackgroundRoutes } from "@/components/layout/BackgroundRoutes";
import { ModalFrame } from "@/components/ui/shared";
import { ThemeProvider } from "@/lib/ThemeProvider";

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
      updatedAt: 1760000000,
    },
    properties: [{ property: { id: "p1", name: "Draußen", icon: "🌳" } }],
    features: [{ feature: { id: "f1", name: "Getränkeverkauf" } }],
    targetGroups: [{ targetGroup: youth }, { targetGroup: adults }],
  }),
];

const CLUB = "Schützenverein Waldblick";
const FEED_NAME = "Schießbetrieb 2026";

type Ev = ReturnType<typeof event> & { id: string; date: string; dateEnd: string | null };
interface Holiday {
  id: string;
  holidayCalendarId: string;
  name: string;
  date: string;
  dateEnd: string | null;
}

/**
 * Stand-in for the public feed API: header with club / calendar / zone / visibility / counters,
 * events and holidays filtered by overlap with from/to, and the single-event endpoint (404 for
 * unknown ids).
 */
function feedApi({
  header = {},
  events: given = feedEvents,
  holidays = [] as Holiday[],
}: { header?: Record<string, unknown>; events?: unknown[]; holidays?: Holiday[] } = {}) {
  const events = given as Ev[];
  return (url: string) => {
    const u = new URL(url);
    const m = u.pathname.match(/^\/api\/feed\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!m) return json({ detail: "Not Found" }, 404);
    const audiences = new Map<string, string>();
    for (const ev of events)
      for (const { targetGroup } of ev.targetGroups as {
        targetGroup: { id: string; name: string };
      }[])
        audiences.set(targetGroup.id, targetGroup.name);
    const feed = {
      id: m[1],
      name: FEED_NAME,
      clubName: CLUB,
      timezone: "Europe/Berlin",
      visibility: "PUBLIC",
      indexable: false,
      eventCount: events.length,
      audiences: [...audiences]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...header,
    };
    if (m[2]) {
      const found = events.find((ev) => ev.id === decodeURIComponent(m[2]));
      return found ? json({ feed, event: found }) : json({ detail: "Event not found" }, 404);
    }
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");
    const overlaps = (start: string, end: string | null) =>
      (!from || (end ?? start) >= from) && (!to || start <= to);
    return json({
      feed,
      events: events.filter((ev) => overlaps(ev.date as string, ev.dateEnd as string | null)),
      holidays: holidays.filter((h) => overlaps(h.date, h.dateEnd)),
    });
  };
}

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
          <BackgroundRoutes
            pages={<Route path="/feed/:feedId" element={<FeedPage />} />}
            modals={
              <Route element={<ModalFrame />}>
                <Route path="/feed/:feedId/events/:eventId" element={<PublicEventModal />} />
              </Route>
            }
          />
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  respond = feedApi();
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
  it("shows a loading state first, then the feed with header, language switch and footer", async () => {
    renderAt("/feed/f1");
    expect(screen.getByRole("status")).toHaveTextContent("Kalender wird geladen.");
    expect(await screen.findByRole("heading", { level: 1, name: FEED_NAME })).toBeInTheDocument();
    // feed name as title, club in the brand row, zone from the API
    expect(screen.getByText(CLUB)).toBeInTheDocument();
    expect(
      screen.getByText("Alle Uhrzeiten gelten in der Zeitzone des Vereins (Europe/Berlin)."),
    ).toBeInTheDocument();
    // no app shell, no login
    expect(screen.queryByRole("navigation", { name: "Bereiche" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zum Inhalt springen" })).toHaveAttribute(
      "href",
      "#main",
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Darstellung" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deutsch" })).toBeInTheDocument();
    expect(screen.getByText("Bereitgestellt mit Club Calendar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Oktober 2026" })).toBeInTheDocument();
    // subscribe
    const sub = screen.getByRole("link", { name: "Kalender abonnieren" });
    expect(sub.getAttribute("href")).toMatch(/^webcal:\/\/.*\/api\/feed\/f1\/ics$/);
    expect(screen.getByRole("link", { name: "Als ICS-Datei laden" })).toHaveAttribute("download");
    expect(document.title).toBe(`${FEED_NAME} – Öffentlicher Kalender`);
  });

  it("loads only the visible month grid, with its holidays", async () => {
    respond = feedApi({
      holidays: [
        {
          id: "h1",
          holidayCalendarId: "hc",
          name: "Tag der Deutschen Einheit",
          date: "2026-10-03",
          dateEnd: null,
        },
      ],
    });
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/api/feed/f1/events?from=2026-09-28&to=2026-11-01");
    expect(
      within(screen.getByRole("grid")).getByRole("button", {
        name: /3\. Oktober.*Feiertag Tag der Deutschen Einheit/,
      }),
    ).toBeInTheDocument();
  });

  it("requests without credentials and never leaks the secret into title or referrer", async () => {
    respond = feedApi({ header: { visibility: "PRIVATE" } });
    renderAt(`/feed/f1?secret=${SECRET}`);
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
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

  it.each([
    ["PUBLIC with the search engine option", { visibility: "PUBLIC", indexable: true }, null],
    ["PUBLIC without the option", { visibility: "PUBLIC", indexable: false }, "noindex, nofollow"],
    ["CLUB", { visibility: "CLUB", indexable: false }, "noindex, nofollow"],
    ["PRIVATE", { visibility: "PRIVATE", indexable: false }, "noindex, nofollow"],
    [
      "a header without the flag",
      { visibility: "PUBLIC", indexable: undefined },
      "noindex, nofollow",
    ],
  ])("robots meta for %s", async (_label, header, expected) => {
    respond = feedApi({ header });
    renderAt(`/feed/f1?secret=${SECRET}`);
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    const metas = document.head.querySelectorAll<HTMLMetaElement>("meta[name=robots]");
    expect(Array.from(metas).map((m) => m.content)).toEqual(expected ? [expected] : []);
    expect(document.head.querySelector("meta[name=referrer]")).toHaveAttribute(
      "content",
      "no-referrer",
    );
  });

  it("marks today in the calendar's zone, not the browser's", async () => {
    // 2026-10-03 23:30 UTC is already 04.10. in Berlin
    vi.setSystemTime(new Date("2026-10-03T23:30:00Z"));
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    const grid = screen.getByRole("grid");
    expect(within(grid).getByLabelText(/^4\. Oktober, heute/)).toBeInTheDocument();
    expect(within(grid).queryByLabelText(/^3\. Oktober, heute/)).not.toBeInTheDocument();
  });

  it("shows the empty state when no event is published", async () => {
    respond = feedApi({ events: [] });
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
    const api = feedApi({ header: { name: "Wieder da" } });
    respond = (url) => (fail ? json({}, 500) : api(url));
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
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
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
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
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

  it("keeps the audience chips of the whole feed in a month without those audiences", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1?groups=tg-j");
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    await user.click(screen.getByRole("button", { name: "Nächster Monat" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "November 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jugend" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("groups=tg-j");
  });

  it("navigates months and says so when a month has no events", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1");
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    await user.click(screen.getByRole("button", { name: "Nächster Monat" }));
    expect(screen.getByRole("heading", { level: 2, name: "November 2026" })).toBeInTheDocument();
    expect(
      await screen.findByText("In diesem Monat gibt es keine veröffentlichten Termine."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("from=2026-10-26&to=2026-12-06")),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Heute" }));
    expect(screen.getByRole("heading", { level: 2, name: "Oktober 2026" })).toBeInTheDocument();
  });

  it("switches to the list of the month and opens an event page that keeps the secret", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt(`/feed/f1?secret=${SECRET}`);
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    await user.click(screen.getByRole("button", { name: "Liste" }));
    const list = screen.getByRole("region", { name: "Termine im Oktober 2026" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    // published only: no status badge on the public page
    expect(within(list).queryByText("Veröffentlicht")).not.toBeInTheDocument();
    const opener = within(list).getByRole("button", { name: "Herbstfest" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Herbstfest" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes(`/api/feed/f1/events/e3?secret=${SECRET}`),
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(`/feed/f1/events/e3?secret=${SECRET}`);
    // The feed stays below the dialog (same view), but inert and hidden from screen readers.
    const feedHeading = screen.getByRole("heading", { level: 1, name: FEED_NAME, hidden: true });
    expect(feedHeading.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: FEED_NAME })).toBeNull();
    // The router state keeps the view, never the secret.
    expect(JSON.stringify(window.history.state ?? "")).not.toContain(SECRET);
    // Closing goes back to the same view with the secret, focus returns to the opener.
    await user.click(within(dialog).getAllByRole("button", { name: "Schließen" })[0]);
    expect(await screen.findByRole("heading", { level: 1, name: FEED_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(`secret=${SECRET}`);
    expect(screen.getByTestId("location")).toHaveTextContent("view=list");
    await waitFor(() => expect(screen.getByRole("button", { name: "Herbstfest" })).toHaveFocus());
  });

  it("closes the event dialog with Escape", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt("/feed/f1?date=2026-10-01&view=list");
    await screen.findByRole("heading", { level: 1, name: FEED_NAME });
    await user.click(screen.getByRole("button", { name: "Jugendtraining" }));
    await screen.findByRole("dialog", { name: "Jugendtraining" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("location")).toHaveTextContent("/feed/f1?date=2026-10-01&view=list");
  });
});

describe("PublicEventModal", () => {
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
    // A shared link shows the feed at the event's month below the dialog.
    // Design (PublicEvent): "Schützenverein Waldblick · Schießbetrieb 2026"
    expect(screen.getByRole("dialog", { name: /Herbstfest/ })).toHaveAccessibleDescription(
      `${CLUB} · ${FEED_NAME}`,
    );
    // The event came from the single-event endpoint
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/feed/f1/events/e3"))).toBe(
      true,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 2, name: "Oktober 2026", hidden: true }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Sa 24.10.2026")).toBeInTheDocument();
    expect(screen.getByText("15:00 bis 22:00 Uhr")).toBeInTheDocument();
    const place = screen.getByRole("region", { name: "Ort" });
    expect(within(place).getByText("Vereinsheim Mitte")).toBeInTheDocument();
    expect(within(place).getByText(/Marktplatz 5, 12345 Musterstadt/)).toBeInTheDocument();
    const mapImg = within(place).getByRole("img", {
      name: "Karte mit Markierung für Vereinsheim Mitte",
    });
    const src = mapImg.getAttribute("src") ?? "";
    expect(src).toContain("/api/map/image/location/l1");
    expect(src).toMatch(/\?v=\d+$/);
    expect(mapImg).toHaveAttribute("width", "800");
    expect(mapImg).toHaveAttribute("height", "288");
    expect(mapImg).toHaveAttribute("loading", "lazy");
    // A failing image falls back to the text note; the address and maps link stay.
    fireEvent.error(mapImg);
    expect(within(place).queryByRole("img")).not.toBeInTheDocument();
    expect(within(place).getByText(/Karte ist gerade nicht verfügbar/)).toBeInTheDocument();
    const maps = within(place).getByRole("link", { name: "In Karten-App öffnen" });
    expect(maps).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(maps.getAttribute("href")).toContain("openstreetmap.org");
    const props = screen.getByRole("region", { name: "Besonderheiten" });
    expect(within(props).getByText("Draußen")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Zusatzangebote" })).getByText("Getränkeverkauf"),
    ).toBeInTheDocument();
    const aud = screen.getByRole("region", { name: "Gruppen" });
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
    respond = feedApi({
      header: { clubName: "<img src=x onerror=alert(1)>" },
      events: [event({ id: "x1", name: "<b>fett</b>", date: "2026-10-08" })],
    });
    renderAt("/feed/f1/events/x1");
    const heading = await screen.findByRole("heading", { level: 1, name: "<b>fett</b>" });
    expect(heading.querySelector("b")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      `<img src=x onerror=alert(1)> · ${FEED_NAME}`,
    );
    expect(document.querySelector("img[src=x]")).toBeNull();
  });

  it("explains an unknown or unpublished event and leads back", async () => {
    respond = feedApi({ header: { visibility: "PRIVATE" } });
    renderAt(`/feed/f1/events/unbekannt?secret=${SECRET}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Termin nicht gefunden" }),
    ).toBeInTheDocument();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Zum Kalender" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("location")).toHaveTextContent(`/feed/f1?secret=${SECRET}`);
    expect(document.querySelector('meta[name="robots"]')).not.toBeNull();
  });

  it.each([
    ["an event of an indexable feed", { indexable: true }, "e3", null],
    ["an event of a club internal feed", { visibility: "CLUB" }, "e3", "noindex, nofollow"],
    ["an unknown event of an indexable feed", { indexable: true }, "nope", "noindex, nofollow"],
  ])("robots meta for %s", async (_label, header, id, expected) => {
    respond = feedApi({ header });
    renderAt(`/feed/f1/events/${id}`);
    await screen.findByRole("heading", {
      level: 1,
      name: id === "e3" ? "Herbstfest" : "Termin nicht gefunden",
    });
    // The feed below the dialog and the dialog each set their own tag; any noindex counts
    await waitFor(() => {
      const contents = Array.from(
        document.head.querySelectorAll<HTMLMetaElement>("meta[name=robots]"),
      ).map((m) => m.content);
      if (expected) expect(contents).toContain(expected);
      else expect(contents).toEqual([]);
    });
  });

  it("tells an unknown feed apart from an unknown event", async () => {
    respond = () => json({ detail: "Not Found" }, 404);
    renderAt("/feed/nope/events/e1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Kalender nicht gefunden" }),
    ).toBeInTheDocument();
  });

  it("shows the private state for a missing secret", async () => {
    respond = () => json({}, 403);
    renderAt("/feed/f1/events/e1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Dieser Kalender ist privat" }),
    ).toBeInTheDocument();
  });

  it("shows multi-day and all-day events as a period", async () => {
    respond = feedApi({
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
    expect(screen.queryByRole("img", { name: /Karte mit Markierung/ })).not.toBeInTheDocument();
  });
});
