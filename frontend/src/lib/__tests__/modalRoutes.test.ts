import { describe, expect, it } from "vitest";
import { matchModal, modalBackground, openModalState } from "../modalRoutes";

const BASE = "/clubs/c1/calendars/k1";

describe("matchModal", () => {
  it("knows the event dialogs and the public event", () => {
    for (const path of [
      `${BASE}/events/new/form`,
      `${BASE}/events/new/template`,
      `${BASE}/events/new/template/t1`,
      `${BASE}/events/e1`,
      `${BASE}/events/e1/series`,
    ]) {
      expect(matchModal(path)).toEqual({
        kind: "event",
        clubId: "c1",
        calendarId: "k1",
        base: BASE,
      });
    }
    expect(matchModal("/feed/f1/events/e3")).toEqual({
      kind: "public",
      feedId: "f1",
      eventId: "e3",
    });
  });

  it("leaves pages alone", () => {
    for (const path of [
      BASE,
      `${BASE}/events`,
      `${BASE}/events/export`,
      `${BASE}/events/export/series`,
      `${BASE}/import`,
      `${BASE}/templates/t1`,
      "/feed/f1",
    ]) {
      expect(matchModal(path)).toBeNull();
    }
  });
});

describe("modalBackground", () => {
  it("uses the page the dialog was opened from", () => {
    expect(
      modalBackground({
        pathname: `${BASE}/events/e1`,
        search: "",
        state: openModalState({ pathname: `${BASE}/events`, search: "?status=draft" }),
      }),
    ).toBe(`${BASE}/events?status=draft`);
  });

  it("falls back to the calendar (with the dialog's date) for deep links", () => {
    expect(
      modalBackground({ pathname: `${BASE}/events/new/form`, search: "?date=2026-10-14" }),
    ).toBe(`${BASE}?date=2026-10-14`);
    expect(modalBackground({ pathname: `${BASE}/events/e1`, search: "", state: null })).toBe(BASE);
    expect(modalBackground({ pathname: `${BASE}/events/new/form`, search: "?date=quatsch" })).toBe(
      BASE,
    );
  });

  it("never uses another dialog or a foreign address as background", () => {
    expect(
      modalBackground({
        pathname: `${BASE}/events/e1`,
        search: "",
        state: { background: `${BASE}/events/new/form` },
      }),
    ).toBe(BASE);
    expect(
      modalBackground({
        pathname: `${BASE}/events/e1`,
        search: "",
        state: { background: "//evil.example/x" },
      }),
    ).toBe(BASE);
  });

  it("keeps the feed view and takes the secret from the address only", () => {
    expect(
      modalBackground({
        pathname: "/feed/f1/events/e3",
        search: "?secret=test-secret-value",
        state: { background: "/feed/f1?view=list&date=2026-10-01" },
      }),
    ).toBe("/feed/f1?view=list&date=2026-10-01&secret=test-secret-value");
    expect(
      modalBackground({
        pathname: "/feed/f1/events/e3",
        search: "",
        state: { background: "/feed/other?view=list" },
      }),
    ).toBe("/feed/f1");
  });

  it("is null for pages", () => {
    expect(modalBackground({ pathname: BASE, search: "" })).toBeNull();
  });
});

describe("legal modals", () => {
  it("matches the legal paths", () => {
    expect(matchModal("/privacy")).toEqual({ kind: "legal", type: "privacy" });
    expect(matchModal("/imprint")).toEqual({ kind: "legal", type: "imprint" });
    expect(matchModal("/terms")).toEqual({ kind: "legal", type: "terms" });
    expect(matchModal("/profile")).toBeNull();
    expect(matchModal("/profile/security")).toBeNull();
  });

  it("is a modal only with a valid stored background", () => {
    const loc = { pathname: "/terms", search: "" };
    expect(modalBackground({ ...loc, state: { background: "/login" } })).toBe("/login");
    expect(modalBackground(loc)).toBeNull();
    expect(modalBackground({ ...loc, state: {} })).toBeNull();
    expect(modalBackground({ ...loc, state: { background: "//evil.example" } })).toBeNull();
    expect(modalBackground({ ...loc, state: { background: "/privacy" } })).toBeNull();
  });
});

describe("personal event dialog", () => {
  it("is a modal above Mein Verein", () => {
    expect(matchModal("/clubs/c1/me/events/e1")).toEqual({
      kind: "my",
      clubId: "c1",
      eventId: "e1",
    });
    expect(modalBackground({ pathname: "/clubs/c1/me/events/e1", search: "" })).toBe(
      "/clubs/c1/me",
    );
    expect(
      modalBackground({
        pathname: "/clubs/c1/me/events/e1",
        search: "",
        state: { background: "/clubs/c1/me?view=list" },
      }),
    ).toBe("/clubs/c1/me?view=list");
  });
});
