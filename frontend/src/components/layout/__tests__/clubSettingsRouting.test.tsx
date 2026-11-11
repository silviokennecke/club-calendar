import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LegacyClubSettingsRedirect } from "../LegacyClubSettingsRedirect";
import {
  activeNavKey,
  buildClubSettingsTabs,
  buildNavGroups,
  buildSettingsTabs,
  buildTabs,
} from "../navigation";

function Probe() {
  const l = useLocation();
  return (
    <div data-testid="at">
      {l.pathname + l.search + l.hash}|{JSON.stringify(l.state)}
    </div>
  );
}

function renderLegacy(url: string, state?: unknown) {
  const CAL = "/clubs/:clubId/calendars/:calendarId";
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: url.split("?")[0],
          search: url.split("?")[1] ? `?${url.split("?")[1]}` : "",
          state,
        },
      ]}
    >
      <Routes>
        {["locations", "target-groups", "feeds", "feeds/new", "feeds/:feedId"].map((p) => (
          <Route key={p} path={`${CAL}/settings/${p}`} element={<LegacyClubSettingsRedirect />} />
        ))}
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("old calendar-level addresses of club data redirect to the club settings", () => {
  it.each([
    ["/clubs/c1/calendars/k1/settings/locations", "/clubs/c1/settings/locations"],
    ["/clubs/c1/calendars/k1/settings/target-groups", "/clubs/c1/settings/target-groups"],
    ["/clubs/c1/calendars/k1/settings/feeds", "/clubs/c1/settings/feeds"],
    ["/clubs/c1/calendars/k1/settings/feeds/new", "/clubs/c1/settings/feeds/new"],
    ["/clubs/c1/calendars/k1/settings/feeds/f9", "/clubs/c1/settings/feeds/f9"],
  ])("%s -> %s", (from, to) => {
    renderLegacy(from);
    expect(screen.getByTestId("at")).toHaveTextContent(`${to}|`);
  });

  it("keeps query and router state", () => {
    renderLegacy("/clubs/c1/calendars/k1/settings/feeds?x=1", { open: "f2" });
    expect(screen.getByTestId("at")).toHaveTextContent(
      '/clubs/c1/settings/feeds?x=1|{"open":"f2"}',
    );
  });
});

describe("navigation", () => {
  it("club settings tabs hold only locations and target groups", () => {
    expect(buildClubSettingsTabs("c1").map((t) => t.href)).toEqual([
      "/clubs/c1/settings/locations",
      "/clubs/c1/settings/target-groups",
    ]);
  });

  it("calendar settings tabs no longer hold the club data", () => {
    expect(
      buildSettingsTabs("c1", "k1").map((t) =>
        t.href.replace("/clubs/c1/calendars/k1/settings", ""),
      ),
    ).toEqual(["", "/properties", "/features", "/holiday-calendars"]);
  });

  it("feeds link to the club settings in sidebar and tab bar and stay hidden for viewers", () => {
    const items = (role: "admin" | "viewer") =>
      buildNavGroups("c1", "k1", role).flatMap((g) => g.items);
    expect(items("admin").find((i) => i.key === "feeds")?.href).toBe("/clubs/c1/settings/feeds");
    expect(items("admin").find((i) => i.key === "clubSettings")?.href).toBe(
      "/clubs/c1/settings/locations",
    );
    expect(items("viewer").some((i) => i.key === "feeds")).toBe(false);
    expect(items("viewer").some((i) => i.key === "clubSettings")).toBe(true);
    expect(buildTabs("c1", "k1", "admin").find((t) => t.key === "feeds")?.href).toBe(
      "/clubs/c1/settings/feeds",
    );
    expect(buildTabs("c1", "k1", "viewer").some((t) => t.key === "feeds")).toBe(false);
  });

  it("detects the club settings areas, also without a calendar", () => {
    for (const cal of ["k1", null]) {
      expect(activeNavKey("/clubs/c1/settings/feeds", "c1", cal)).toBe("feeds");
      expect(activeNavKey("/clubs/c1/settings/feeds/new", "c1", cal)).toBe("feeds");
      expect(activeNavKey("/clubs/c1/settings/locations", "c1", cal)).toBe("clubSettings");
      expect(activeNavKey("/clubs/c1/settings/target-groups", "c1", cal)).toBe("clubSettings");
    }
    expect(activeNavKey("/clubs/c1/calendars/k1/settings/properties", "c1", "k1")).toBe("settings");
  });
});
