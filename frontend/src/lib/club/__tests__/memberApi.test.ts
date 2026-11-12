import { describe, expect, it } from "vitest";
import { isPlainMember, isStaff, permissionsFor } from "../permissions";
import { memberMayOpen, myClubPath, parseMyClubTab } from "../myClub";
import { mySubscriptionAddresses } from "../memberApi";

describe("roles", () => {
  it("isStaff starts at viewer", () => {
    expect(isStaff("member")).toBe(false);
    expect(isStaff(undefined)).toBe(false);
    for (const role of ["viewer", "editor", "admin"] as const) expect(isStaff(role)).toBe(true);
    expect(isPlainMember("member")).toBe(true);
    expect(permissionsFor("viewer").isStaff).toBe(true);
    expect(permissionsFor("member")).toMatchObject({ isStaff: false, canEdit: false });
  });
});

describe("Mein Verein paths", () => {
  it("builds paths and parses the tab", () => {
    expect(myClubPath("c1")).toBe("/clubs/c1/me");
    expect(myClubPath("c1", "subscription")).toBe("/clubs/c1/me?tab=subscription");
    expect(parseMyClubTab("subscription")).toBe("subscription");
    expect(parseMyClubTab("x")).toBe("calendar");
  });

  it("lets a member open only Mein Verein and the profile", () => {
    expect(memberMayOpen("/clubs/c1/me", "c1")).toBe(true);
    expect(memberMayOpen("/clubs/c1/me/", "c1")).toBe(true);
    expect(memberMayOpen("/profile", "c1")).toBe(true);
    for (const tab of ["security", "apps", "privacy"])
      expect(memberMayOpen(`/profile/${tab}`, "c1")).toBe(true);
    expect(memberMayOpen("/profiles", "c1")).toBe(false);
    expect(memberMayOpen("/clubs/c1/me/events/e1", "c1")).toBe(true);
    expect(memberMayOpen("/clubs/c2/me/events/e1", "c1")).toBe(false);
    expect(memberMayOpen("/clubs/c1", "c1")).toBe(false);
    expect(memberMayOpen("/clubs/c1/calendars/k1", "c1")).toBe(false);
    expect(memberMayOpen("/clubs/c2/me", "c1")).toBe(false);
  });
});

describe("mySubscriptionAddresses", () => {
  it("builds the personal ICS and webcal address", () => {
    const { ics, webcal } = mySubscriptionAddresses(
      { id: "s1", secret: "abc" },
      "https://kalender.example/",
    );
    expect(ics).toBe("https://kalender.example/api/feed/me/s1/ics?secret=abc");
    expect(webcal).toBe("webcal://kalender.example/api/feed/me/s1/ics?secret=abc");
  });
});
