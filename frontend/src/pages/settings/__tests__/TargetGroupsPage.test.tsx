import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import TargetGroupsPage from "../TargetGroupsPage";
import { CLUB_BASE, CLUB_PATTERN, renderRoute } from "../../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const route = `${CLUB_PATTERN}/settings/target-groups`;
const url = `${CLUB_BASE}/settings/target-groups`;

beforeEach(() => {
  apiGet.mockReset();
});

describe("TargetGroupsPage (club settings)", () => {
  it("works without a calendar in the route: club heading, tabs, club-level list", async () => {
    mockApiGet(apiGet, (path: string) =>
      path === "/api/clubs/c1/target-groups"
        ? Promise.resolve([{ id: "g1", name: "Jugend" }])
        : Promise.resolve([]),
    );
    renderRoute(route, url, <TargetGroupsPage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Vereinseinstellungen" }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("Jugend")).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/gelten für alle Kalender des Vereins|Sie gelten für alle Kalender/),
    ).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Einstellungen des Vereins" });
    expect(within(tabs).getByRole("link", { name: "Gruppen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Orte" })).toHaveAttribute(
      "href",
      "/clubs/c1/settings/locations",
    );
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining("/calendars/undefined"));
  });

  it("is read-only for viewers and hides the feeds tab", async () => {
    mockApiGet(
      apiGet,
      (path: string) =>
        path === "/api/clubs/c1/target-groups"
          ? Promise.resolve([{ id: "g1", name: "Jugend" }])
          : Promise.resolve([]),
      "viewer",
    );
    renderRoute(route, url, <TargetGroupsPage />);
    expect((await screen.findAllByText("Jugend")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/erlaubt nur das Ansehen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gruppe anlegen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Feeds" })).not.toBeInTheDocument();
  });
});
