import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventsInRange,
  fetchPublicEvent,
  fetchPublicFeed,
  filterPublicEvents,
  mapLinkFor,
  parseGroupIds,
  publicBackPath,
  publicEventPath,
  publicFeedAddresses,
  publicFeedPath,
  PublicFeedError,
  viewPathWithoutSecret,
  type PublicFeedEvent,
} from "../public";

function ev(partial: Partial<PublicFeedEvent> & { id: string; name: string; date: string }) {
  return {
    timeBegin: "19:00",
    timeEnd: "21:00",
    properties: [],
    features: [],
    targetGroups: [],
    ...partial,
  } as PublicFeedEvent;
}

const youth = { targetGroup: { id: "tg-j", name: "Jugend" } };
const adults = { targetGroup: { id: "tg-e", name: "Erwachsene" } };

describe("public feed helpers", () => {
  const events = [
    ev({ id: "a", name: "Training", date: "2026-10-08", timezone: "Europe/Berlin" }),
    ev({
      id: "b",
      name: "Jugendtraining",
      date: "2026-10-09",
      timezone: "Europe/Berlin",
      targetGroups: [youth],
    }),
    ev({
      id: "c",
      name: "Herbstfest",
      date: "2026-10-30",
      dateEnd: "2026-11-02",
      timezone: "Europe/London",
      targetGroups: [adults, youth],
    }),
  ];

  it("filters by audience and by name (case-insensitive)", () => {
    expect(filterPublicEvents(events, [], "").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(filterPublicEvents(events, ["tg-j"], "").map((e) => e.id)).toEqual(["b", "c"]);
    expect(filterPublicEvents(events, ["tg-j"], " FEST ").map((e) => e.id)).toEqual(["c"]);
    expect(filterPublicEvents(events, [], "gibt es nicht")).toEqual([]);
  });

  it("counts multi-day events in every month they touch", () => {
    expect(eventsInRange(events, "2026-10-01", "2026-10-31").map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(eventsInRange(events, "2026-11-01", "2026-11-30").map((e) => e.id)).toEqual(["c"]);
    expect(eventsInRange(events, "2026-12-01", "2026-12-31")).toEqual([]);
  });

  it("keeps only known audience ids from the URL", () => {
    const known = [
      { id: "tg-e", name: "Erwachsene" },
      { id: "tg-j", name: "Jugend" },
    ];
    expect(parseGroupIds("tg-j,unknown,tg-j,tg-e", known)).toEqual(["tg-j", "tg-e"]);
    expect(parseGroupIds(null, known)).toEqual([]);
  });

  it("builds subscribe addresses with secret and audiences", () => {
    const plain = publicFeedAddresses("f1", undefined, [], "http://api.test");
    expect(plain.ics).toBe("http://api.test/api/feed/f1/ics");
    expect(plain.webcal).toBe("webcal://api.test/api/feed/f1/ics");
    const priv = publicFeedAddresses(
      "f1",
      "test-secret-value",
      ["tg-j", "tg-e"],
      "https://api.test/",
    );
    expect(priv.ics).toBe(
      "https://api.test/api/feed/f1/ics?secret=test-secret-value&targetGroupIds=tg-j%2Ctg-e",
    );
    expect(priv.webcal.startsWith("webcal://api.test/")).toBe(true);
  });

  it("keeps the secret in in-app paths", () => {
    expect(publicFeedPath("f1", undefined)).toBe("/feed/f1");
    expect(publicFeedPath("f1", "test-secret-value", { date: "2026-10-08", q: "" })).toBe(
      "/feed/f1?secret=test-secret-value&date=2026-10-08",
    );
    expect(publicEventPath("f1", "e1", "test-secret-value")).toBe(
      "/feed/f1/events/e1?secret=test-secret-value",
    );
    expect(publicEventPath("f1", "e1", undefined)).toBe("/feed/f1/events/e1");
  });

  it("keeps the secret out of the router state and puts it back on the way back", () => {
    expect(viewPathWithoutSecret("/feed/f1", "?secret=geheim-wort&date=2026-10-08&view=list")).toBe(
      "/feed/f1?date=2026-10-08&view=list",
    );
    expect(viewPathWithoutSecret("/feed/f1", "")).toBe("/feed/f1");
    expect(publicBackPath("f1", "geheim-wort", "/feed/f1?date=2026-10-08&view=list")).toBe(
      "/feed/f1?date=2026-10-08&view=list&secret=geheim-wort",
    );
    expect(publicBackPath("f1", undefined, "/feed/f1?q=Jugend")).toBe("/feed/f1?q=Jugend");
    // other feeds, prefixes, foreign values and missing state fall back to the feed itself
    expect(publicBackPath("f1", "geheim-wort", "/feed/f10?date=2026-10-08")).toBe(
      "/feed/f1?secret=geheim-wort",
    );
    expect(publicBackPath("f1", undefined, "https://evil.example/", { date: "2026-10-08" })).toBe(
      "/feed/f1?date=2026-10-08",
    );
    expect(publicBackPath("f1", undefined, undefined)).toBe("/feed/f1");
  });

  it("links maps by coordinates or address, never with the page address", () => {
    expect(mapLinkFor({ latitude: 50.1, longitude: 8.6 }, "Marktplatz 5")).toContain("mlat=50.1");
    expect(mapLinkFor({}, "Marktplatz 5, 12345 Musterstadt")).toBe(
      "https://www.openstreetmap.org/search?query=Marktplatz%205%2C%2012345%20Musterstadt",
    );
    expect(mapLinkFor({}, "")).toBeNull();
  });
});

describe("fetchPublicFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(response: Partial<Response> | Error) {
    const fn = vi.fn(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response as Response),
    );
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("sends the secret as query and no referrer, and drops drafts", async () => {
    const fn = stubFetch({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          feed: { id: "f1", name: "Feed", timezone: "Europe/Berlin" },
          holidays: [
            {
              id: "h1",
              holidayCalendarId: "hc",
              name: "Ferien",
              date: "2026-10-12",
              dateEnd: null,
            },
          ],
          events: [
            ev({ id: "a", name: "Offen", date: "2026-10-08" }),
            ev({ id: "d", name: "Entwurf", date: "2026-10-09", isDraft: true }),
          ],
        }),
    });
    const data = await fetchPublicFeed("f1", "test-secret-value");
    expect(data.events.map((e) => e.name)).toEqual(["Offen"]);
    expect(data.holidays.map((h) => h.name)).toEqual(["Ferien"]);
    expect(data.feed.audiences).toEqual([]);
    const calls = fn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain("/api/feed/f1/events?secret=test-secret-value");
    expect(calls[0][1].referrerPolicy).toBe("no-referrer");
    expect(calls[0][1]).not.toHaveProperty("headers");
  });

  it.each([
    [403, "private"],
    [404, "notFound"],
    [500, "error"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    stubFetch({ ok: false, status });
    await expect(fetchPublicFeed("f1", undefined)).rejects.toMatchObject({ kind });
  });

  it("asks for the visible days only", async () => {
    const fn = stubFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ feed: { id: "f1", name: "Feed" }, events: [] }),
    });
    const data = await fetchPublicFeed("f1", undefined, { from: "2026-09-28", to: "2026-11-08" });
    expect(data.holidays).toEqual([]);
    const calls = fn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain("/api/feed/f1/events?from=2026-09-28&to=2026-11-08");
  });

  it("loads one event with the secret and maps a missing event to notFound", async () => {
    const fn = stubFetch({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          feed: { id: "f1", name: "Feed", audiences: [{ id: "tg-j", name: "Jugend" }] },
          event: ev({ id: "a b", name: "Herbstfest", date: "2026-10-24" }),
        }),
    });
    const data = await fetchPublicEvent("f1", "a b", "test-secret-value");
    expect(data.event.name).toBe("Herbstfest");
    expect(data.feed.audiences).toEqual([{ id: "tg-j", name: "Jugend" }]);
    const calls = fn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain("/api/feed/f1/events/a%20b?secret=test-secret-value");
    expect(calls[0][1].referrerPolicy).toBe("no-referrer");

    stubFetch({ ok: false, status: 404 });
    await expect(fetchPublicEvent("f1", "x", undefined)).rejects.toMatchObject({
      kind: "notFound",
    });
  });

  it("treats a network failure as error", async () => {
    stubFetch(new TypeError("offline"));
    const err = await fetchPublicFeed("f1", undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublicFeedError);
    expect((err as PublicFeedError).kind).toBe("error");
  });
});
