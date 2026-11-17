import { describe, expect, it } from "vitest";
import { calendarPermissions, isPlainMember, isStaff, permissionsFor } from "../permissions";
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

describe("calendar permissions", () => {
  const member = {
    role: "member" as const,
    calendars: [{ id: "k1", name: "A", timezone: null, archivedAt: null }],
  };

  it("lets a member write only in the calendars they hold a permission for", () => {
    expect(calendarPermissions(member, "k1")).toEqual({
      canWrite: true,
      canManageClubData: false,
      isAdmin: false,
    });
    expect(calendarPermissions(member, "k2").canWrite).toBe(false);
    expect(calendarPermissions({ role: "member" }, "k1").canWrite).toBe(false);
  });

  it("keeps the role rules for staff", () => {
    expect(calendarPermissions({ role: "viewer" }, "k1").canWrite).toBe(false);
    expect(calendarPermissions({ role: "editor" }, "k1")).toMatchObject({
      canWrite: true,
      canManageClubData: true,
      isAdmin: false,
    });
    expect(calendarPermissions({ role: "admin" }, "k1").isAdmin).toBe(true);
    expect(calendarPermissions(undefined, "k1").canWrite).toBe(false);
  });

  it("opens only the permitted calendars' pages and read-only settings to a member", () => {
    const ids = ["k1"];
    for (const rest of ["", "/events", "/events/e1", "/import", "/templates/new", "/more"])
      expect(memberMayOpen(`/clubs/c1/calendars/k1${rest}`, "c1", ids)).toBe(true);
    for (const rest of ["", "/properties", "/features", "/holiday-calendars"])
      expect(memberMayOpen(`/clubs/c1/calendars/k1/settings${rest}`, "c1", ids)).toBe(true);
    for (const rest of ["/permissions", "/locations", "/target-groups", "/feeds", "/feeds/new"])
      expect(memberMayOpen(`/clubs/c1/calendars/k1/settings${rest}`, "c1", ids)).toBe(false);
    expect(memberMayOpen("/clubs/c1/calendars/k2", "c1", ids)).toBe(false);
    expect(memberMayOpen("/clubs/c2/calendars/k1", "c1", ids)).toBe(false);
    expect(memberMayOpen("/clubs/c1/settings/locations", "c1", ids)).toBe(false);
    expect(memberMayOpen("/clubs/c1/settings/resources", "c1", ids)).toBe(false);
    expect(memberMayOpen("/clubs/c1", "c1", ids)).toBe(false);
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
