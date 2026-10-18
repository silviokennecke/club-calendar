import { describe, expect, it } from "vitest";
import {
  dropsSecret,
  effectiveSearchable,
  emptyFeedValues,
  feedAddresses,
  feedStatus,
  feedAudienceIds,
  feedValuesFromRecord,
  isFeedDirty,
  toFeedPayload,
  toggleId,
  validateFeed,
} from "..";
import type { CalendarFeed } from "@/lib/types";

const feed = (over: Partial<CalendarFeed> = {}): CalendarFeed => ({
  id: "f1",
  clubId: "k1",
  calendarIds: ["c1"],
  name: "Öffentlicher Kalender",
  visibility: "PUBLIC",
  searchable: false,
  indexable: false,
  sharedSecret: "abc123",
  targetGroups: [],
  ...over,
});

describe("feedAddresses", () => {
  it("builds the three addresses of a public feed without the secret", () => {
    const a = feedAddresses(feed(), "https://api.example.org/", "https://app.example.org");
    expect(a.ics).toBe("https://api.example.org/api/feed/f1/ics");
    expect(a.webcal).toBe("webcal://api.example.org/api/feed/f1/ics");
    expect(a.web).toBe("https://app.example.org/feed/f1");
  });
  it("builds the addresses of a club internal feed without the secret", () => {
    const a = feedAddresses(
      feed({ visibility: "CLUB" }),
      "https://api.example.org",
      "https://app.example.org",
    );
    expect(a.ics).toBe("https://api.example.org/api/feed/f1/ics");
    expect(a.web).toBe("https://app.example.org/feed/f1");
  });
  it("puts the secret into every address of a private feed", () => {
    const a = feedAddresses(
      feed({ visibility: "PRIVATE", sharedSecret: "k7 Q/x" }),
      "http://localhost:3001",
      "http://localhost:5199",
    );
    expect(a.ics).toBe("http://localhost:3001/api/feed/f1/ics?secret=k7%20Q%2Fx");
    expect(a.webcal).toBe("webcal://localhost:3001/api/feed/f1/ics?secret=k7%20Q%2Fx");
    expect(a.web).toBe("http://localhost:5199/feed/f1?secret=k7%20Q%2Fx");
  });
});

describe("feed form values", () => {
  it("starts club internal, not searchable, with no audience filter", () => {
    expect(emptyFeedValues(["c1"])).toEqual({
      name: "",
      visibility: "CLUB",
      searchable: false,
      calendarIds: ["c1"],
      targetGroupIds: [],
    });
  });
  it("reads the search engine option only for public feeds", () => {
    expect(feedValuesFromRecord(feed({ searchable: true })).searchable).toBe(true);
    expect(feedValuesFromRecord(feed({ visibility: "CLUB", searchable: true })).searchable).toBe(
      false,
    );
  });
  it("reads the audience ids from the API shape", () => {
    const f = feed({
      targetGroups: [
        { feedId: "f1", targetGroupId: "g1" },
        { feedId: "f1", targetGroupId: "g2" },
      ],
    });
    expect(feedAudienceIds(f)).toEqual(["g1", "g2"]);
    expect(feedValuesFromRecord(f).targetGroupIds).toEqual(["g1", "g2"]);
  });
  it("requires a name", () => {
    expect(validateFeed({ ...emptyFeedValues(["c1"]), name: "  " })).toEqual(["nameEmpty"]);
    expect(validateFeed({ ...emptyFeedValues(["c1"]), name: "Jugend" })).toEqual([]);
  });
  it("requires at least one calendar", () => {
    expect(validateFeed({ ...emptyFeedValues(), name: "Jugend" })).toEqual(["noCalendar"]);
  });
  it("reads and sends the calendars of the feed", () => {
    const values = feedValuesFromRecord(feed({ calendarIds: ["c1", "c2"] }));
    expect(values.calendarIds).toEqual(["c1", "c2"]);
    expect(toFeedPayload(values).calendarIds).toEqual(["c1", "c2"]);
    expect(isFeedDirty(values, { ...values, calendarIds: ["c1"] })).toBe(true);
  });
  it("detects changes regardless of audience order and surrounding spaces", () => {
    const initial = {
      name: "A",
      visibility: "PUBLIC" as const,
      searchable: false,
      calendarIds: ["c1"],
      targetGroupIds: ["g1", "g2"],
    };
    expect(isFeedDirty(initial, { ...initial, name: " A ", targetGroupIds: ["g2", "g1"] })).toBe(
      false,
    );
    expect(isFeedDirty(initial, { ...initial, visibility: "PRIVATE" })).toBe(true);
    expect(isFeedDirty(initial, { ...initial, targetGroupIds: ["g1"] })).toBe(true);
    expect(isFeedDirty(initial, { ...initial, searchable: true })).toBe(true);
    // The option of a non-public feed is never saved, so it does not count as a change
    const club = { ...initial, visibility: "CLUB" as const };
    expect(isFeedDirty(club, { ...club, searchable: true })).toBe(false);
  });
  it("trims the name in the payload", () => {
    expect(
      toFeedPayload({
        name: " Jugend ",
        visibility: "PRIVATE",
        searchable: false,
        calendarIds: ["c1"],
        targetGroupIds: ["g1"],
      }),
    ).toEqual({
      name: "Jugend",
      visibility: "PRIVATE",
      searchable: false,
      calendarIds: ["c1"],
      targetGroupIds: ["g1"],
    });
  });
  it("sends searchable only for public feeds", () => {
    const base = { name: "A", searchable: true, calendarIds: ["c1"], targetGroupIds: [] };
    expect(toFeedPayload({ ...base, visibility: "PUBLIC" }).searchable).toBe(true);
    expect(toFeedPayload({ ...base, visibility: "CLUB" }).searchable).toBe(false);
    expect(toFeedPayload({ ...base, visibility: "PRIVATE" }).searchable).toBe(false);
    expect(effectiveSearchable({ visibility: "PUBLIC", searchable: false })).toBe(false);
  });
  it("asks before a saved private feed loses its secret", () => {
    expect(dropsSecret({ visibility: "PRIVATE" }, { visibility: "CLUB" })).toBe(true);
    expect(dropsSecret({ visibility: "PRIVATE" }, { visibility: "PUBLIC" })).toBe(true);
    expect(dropsSecret({ visibility: "PRIVATE" }, { visibility: "PRIVATE" })).toBe(false);
    expect(dropsSecret({ visibility: "CLUB" }, { visibility: "PUBLIC" })).toBe(false);
    expect(dropsSecret({ visibility: "PUBLIC" }, { visibility: "PRIVATE" })).toBe(false);
    // A new feed has no secret yet
    expect(dropsSecret(undefined, { visibility: "CLUB" })).toBe(false);
  });
  it("maps each status to its badge", () => {
    expect(feedStatus("PUBLIC")).toBe("public");
    expect(feedStatus("CLUB")).toBe("club");
    expect(feedStatus("PRIVATE")).toBe("private");
  });
  it("toggles ids", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});
