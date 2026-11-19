import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../Sidebar";
import { Tabbar } from "../Tabbar";
import type { ShellData } from "../shellTypes";

const base = "/clubs/c1/calendars/k1";

function data(overrides: Partial<ShellData> = {}): ShellData {
  return {
    clubs: [
      { id: "c1", name: "Schützenverein Waldblick", timezone: "Europe/Berlin", role: "admin" },
      { id: "c2", name: "Segelclub Möwe e. V.", timezone: "Europe/Berlin" },
    ],
    calendars: [
      { id: "k1", clubId: "c1", name: "Schießbetrieb 2026" },
      { id: "k2", clubId: "c1", name: "Saison 2025", archivedAt: "2025-12-31T00:00:00Z" },
    ],
    clubId: "c1",
    calendarId: "k1",
    userName: "Alex Beispiel",
    onSelectClub: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
}

function renderAt(path: string, d = data()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar data={d} />
    </MemoryRouter>,
  );
}

function current() {
  const nav = screen.getByRole("navigation", { name: "Bereiche" });
  return within(nav)
    .getAllByRole("link")
    .filter((l) => l.getAttribute("aria-current") === "page")
    .map((l) => l.textContent);
}

vi.mock("@/lib/registration", () => ({
  useClubCreationAllowed: () => ({ allowed: true, loading: false }),
}));

describe("Sidebar navigation", () => {
  it.each([
    [base, "Kalender"],
    [`${base}/events`, "Alle Termine"],
    [`${base}/import`, "Alle Termine"],
    [`${base}/templates`, "Vorlagen"],
    [`${base}/settings`, "Einstellungen"],
    [`${base}/settings/properties`, "Einstellungen"],
    ["/clubs/c1/settings/feeds", "Veröffentlichen"],
    ["/clubs/c1/settings/feeds/new", "Veröffentlichen"],
    ["/clubs/c1/settings/locations", "Orte und Gruppen"],
    ["/clubs/c1/settings/target-groups", "Orte und Gruppen"],
    [`${base}/events/export`, "Veröffentlichen"],
    ["/clubs/c1/general", "Verein verwalten"],
    ["/clubs/c1/members", "Verein verwalten"],
  ])("marks exactly one link as current on %s", (path, label) => {
    renderAt(path);
    expect(current()).toEqual([label]);
  });

  it("links point to the existing routes", () => {
    renderAt(base);
    expect(screen.getByRole("link", { name: "Veröffentlichen" })).toHaveAttribute(
      "href",
      "/clubs/c1/settings/feeds",
    );
    expect(screen.getByRole("link", { name: "Orte und Gruppen" })).toHaveAttribute(
      "href",
      "/clubs/c1/settings/locations",
    );
    expect(screen.getByRole("link", { name: "Verein verwalten" })).toHaveAttribute(
      "href",
      "/clubs/c1/general",
    );
  });

  it("links the logo to the home page", () => {
    renderAt(base);
    expect(screen.getByRole("link", { name: "Club Calendar" })).toHaveAttribute("href", "/");
  });

  it("marks the profile link as current on /profile", async () => {
    renderAt("/profile");
    await userEvent.click(screen.getByRole("button", { name: /Alex Beispiel/ }));
    expect(screen.getByRole("menuitem", { name: "Profileinstellungen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(current()).toEqual([]);
  });

  it.each(["/profile/security", "/profile/apps", "/profile/privacy"])(
    "keeps the profile link current on the tab %s",
    async (path) => {
      renderAt(path);
      await userEvent.click(screen.getByRole("button", { name: /Alex Beispiel/ }));
      expect(screen.getByRole("menuitem", { name: "Profileinstellungen" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(current()).toEqual([]);
    },
  );

  it("opens the calendar switcher and marks the current calendar", async () => {
    renderAt(base);
    const trigger = screen.getByRole("button", { name: /Kalender.*Schießbetrieb 2026/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Kalender wechseln" });
    expect(within(panel).getByRole("link", { name: /Schießbetrieb 2026/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(panel).getByRole("link", { name: /Saison 2025 \(archiviert\)/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("switches club via the club menu", async () => {
    const d = data();
    renderAt(base, d);
    await userEvent.click(screen.getByRole("button", { name: /Verein.*Waldblick/ }));
    await userEvent.click(screen.getByRole("button", { name: /Segelclub/ }));
    expect(d.onSelectClub).toHaveBeenCalledWith("c2");
  });

  it("shows an archived calendar as a status badge", () => {
    renderAt("/clubs/c1/calendars/k2", data({ calendarId: "k2" }));
    expect(screen.getByText("Archiviert, schreibgeschützt")).toBeInTheDocument();
  });

  it("signs out via the user menu", async () => {
    const d = data();
    renderAt(base, d);
    expect(screen.queryByRole("button", { name: "Abmelden" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /Alex Beispiel/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Profileinstellungen" })).toHaveAttribute(
      "href",
      "/profile",
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Abmelden" }));
    expect(d.onLogout).toHaveBeenCalled();
  });

  it("closes the user menu with Escape and returns focus", async () => {
    renderAt(base);
    const trigger = screen.getByRole("button", { name: /Alex Beispiel/ });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});

describe("help link", () => {
  it("opens the help page of the current screen in a new tab", () => {
    renderAt(`/clubs/c1/settings/target-groups`);
    const link = screen.getByRole("link", { name: /Hilfe/ });
    expect(link).toHaveAttribute("href", "/help/organize/target-groups");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("Tabbar", () => {
  it.each([
    [base, "Kalender"],
    [`${base}/templates`, "Termine"],
    ["/clubs/c1/settings/feeds", "Veröffentlichen"],
    ["/clubs/c1/settings/feeds/f1", "Veröffentlichen"],
    ["/clubs/c1/settings/locations", "Mehr"],
    [`${base}/settings`, "Mehr"],
    [`${base}/more`, "Mehr"],
    [`${base}/events/export`, "Veröffentlichen"],
  ])("highlights the right tab on %s", (path, label) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Tabbar clubId="c1" calendarId="k1" role="admin" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Hauptbereiche" });
    const active = within(nav)
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(label);
  });
});

describe("collapsible sidebar", () => {
  beforeEach(() => localStorage.clear());

  const toggle = () => screen.getByRole("button", { name: "Seitenleiste ein- oder ausklappen" });

  it("is expanded by default and exposes the state on the toggle", () => {
    renderAt(base);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveAttribute("aria-controls", screen.getByRole("complementary").id);
    expect(screen.getByRole("complementary")).not.toHaveClass("ap-side--rail");
  });

  it("collapses to a rail, keeps accessible names and stores the state", async () => {
    renderAt(base);
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("complementary")).toHaveClass("ap-side--rail");
    expect(localStorage.getItem("sidebar_collapsed")).toBe("1");
    expect(screen.getByRole("link", { name: "Veröffentlichen" })).toHaveAttribute(
      "href",
      "/clubs/c1/settings/feeds",
    );
    expect(
      screen.getByRole("link", { name: "Veröffentlichen" }).querySelector(".ap-sr"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /Kalender.*Schießbetrieb 2026/ })).toBeVisible();
    await userEvent.click(toggle());
    expect(screen.getByRole("complementary")).not.toHaveClass("ap-side--rail");
    expect(localStorage.getItem("sidebar_collapsed")).toBe("0");
  });

  it("starts collapsed when stored and shows a tooltip on hover", async () => {
    localStorage.setItem("sidebar_collapsed", "1");
    renderAt(base);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await userEvent.hover(screen.getByRole("link", { name: "Veröffentlichen" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Veröffentlichen");
  });

  it("shows the tooltip when a rail item gets keyboard focus", async () => {
    localStorage.setItem("sidebar_collapsed", "1");
    renderAt(base);
    const link = screen.getByRole("link", { name: "Veröffentlichen" });
    for (let i = 0; i < 20 && document.activeElement !== link; i++) await userEvent.tab();
    expect(link).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Veröffentlichen");
  });

  it("works without localStorage", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderAt(base);
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle());
    spy.mockRestore();
    set.mockRestore();
  });

  it("keeps the user menu usable in the rail", async () => {
    const d = data();
    localStorage.setItem("sidebar_collapsed", "1");
    renderAt(base, d);
    const trigger = screen.getByRole("button", { name: /Alex Beispiel/ });
    await userEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Profileinstellungen" })).toBeVisible();
    await userEvent.click(screen.getByRole("menuitem", { name: "Abmelden" }));
    expect(d.onLogout).toHaveBeenCalled();
  });
});
