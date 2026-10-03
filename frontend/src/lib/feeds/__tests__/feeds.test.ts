import { describe, expect, it } from "vitest";
import {
  emptyFeedValues,
  feedAddresses,
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
  calendarid: "k1",
  name: "Öffentlicher Kalender",
  visibility: "PUBLIC",
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
  it("starts public with no audience filter", () => {
    expect(emptyFeedValues()).toEqual({ name: "", visibility: "PUBLIC", targetGroupIds: [] });
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
    expect(validateFeed({ ...emptyFeedValues(), name: "  " })).toEqual(["nameEmpty"]);
    expect(validateFeed({ ...emptyFeedValues(), name: "Jugend" })).toEqual([]);
  });
  it("detects changes regardless of audience order and surrounding spaces", () => {
    const initial = { name: "A", visibility: "PUBLIC" as const, targetGroupIds: ["g1", "g2"] };
    expect(isFeedDirty(initial, { ...initial, name: " A ", targetGroupIds: ["g2", "g1"] })).toBe(
      false,
    );
    expect(isFeedDirty(initial, { ...initial, visibility: "PRIVATE" })).toBe(true);
    expect(isFeedDirty(initial, { ...initial, targetGroupIds: ["g1"] })).toBe(true);
  });
  it("trims the name in the payload", () => {
    expect(
      toFeedPayload({ name: " Jugend ", visibility: "PRIVATE", targetGroupIds: ["g1"] }),
    ).toEqual({
      name: "Jugend",
      visibility: "PRIVATE",
      targetGroupIds: ["g1"],
    });
  });
  it("toggles ids", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});
