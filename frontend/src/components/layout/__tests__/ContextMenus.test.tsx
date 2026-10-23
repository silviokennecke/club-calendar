import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../Sidebar";
import { Topbar } from "../Topbar";
import MorePage from "@/pages/MorePage";
import type { ShellData } from "../shellTypes";

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ updateUser: vi.fn() }) }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useOutletContext: () => currentData,
}));

let currentData: ShellData;

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

const base = "/clubs/c1/calendars/k1";

function renderShell(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={[base]}>{ui}</MemoryRouter>);
}

describe("desktop club menu", () => {
  it("lists clubs, all clubs and 'create new club' (design: Verein wechseln)", async () => {
    renderShell(<Sidebar data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /Verein.*Waldblick/ }));
    const panel = screen.getByRole("region", { name: "Verein wechseln" });
    expect(within(panel).getByRole("button", { name: /Waldblick/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(panel).getByRole("link", { name: "Alle Vereine anzeigen" })).toHaveAttribute(
      "href",
      "/clubs?select=1",
    );
    expect(within(panel).getByRole("link", { name: "Neuen Verein anlegen" })).toHaveAttribute(
      "href",
      "/setup?new=1",
    );
  });
});

describe("calendar menu", () => {
  it("shows archived calendars with the archive icon and a manage link", async () => {
    renderShell(<Sidebar data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /Kalender.*Schießbetrieb/ }));
    const panel = screen.getByRole("region", { name: "Kalender wechseln" });
    const archived = within(panel).getByRole("link", { name: /Saison 2025 \(archiviert\)/ });
    expect(archived).toHaveAttribute("href", "/clubs/c1/calendars/k2");
    expect(archived.querySelector("svg")).toHaveClass("lucide-archive");
    expect(within(panel).getByRole("link", { name: "Kalender verwalten" })).toHaveAttribute(
      "href",
      "/clubs/c1",
    );
  });

  it("can be operated with the keyboard", async () => {
    renderShell(<Sidebar data={data()} />);
    const trigger = screen.getByRole("button", { name: /Kalender.*Schießbetrieb/ });
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Kalender wechseln" });
    const links = within(panel).getAllByRole("link");
    expect(links[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(links[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(links[links.length - 1]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(links[0]).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes when focus leaves the menu with Tab", async () => {
    renderShell(<Sidebar data={data()} />);
    const trigger = screen.getByRole("button", { name: /Verein.*Waldblick/ });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // two clubs, "all clubs", "new club", then out of the switcher
    for (let i = 0; i < 5; i++) await userEvent.tab();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("mobile top bar menu (design: ContextSwitcherMobile)", () => {
  it("names the profile link after its visible initials (label in name)", () => {
    renderShell(<Topbar data={data()} />);
    const link = screen.getByRole("link", { name: /Mein Profil/ });
    expect(link).toHaveTextContent("AB");
    expect(link).toHaveAccessibleName(/^AB\s*, Mein Profil$/);
    expect(link).not.toHaveAttribute("aria-label");
  });

  it("combines clubs and calendars in one panel", async () => {
    renderShell(<Topbar data={data()} />);
    const trigger = screen.getByRole("button", { name: /Schützenverein Waldblick.*Schießbetrieb/ });
    await userEvent.click(trigger);
    const panel = screen.getByRole("region", { name: "Verein und Kalender wechseln" });
    expect(within(panel).getByRole("button", { name: /Segelclub/ })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Neuen Verein anlegen" })).toHaveAttribute(
      "href",
      "/setup?new=1",
    );
    expect(within(panel).getByRole("link", { name: /Saison 2025 \(archiviert\)/ })).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Kalender verwalten" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Mein Profil/ })).toHaveAttribute("href", "/profile");
  });

  it("switches the club and closes the menu", async () => {
    const d = data();
    renderShell(<Topbar data={d} />);
    await userEvent.click(screen.getByRole("button", { name: /Schießbetrieb/ }));
    await userEvent.click(screen.getByRole("button", { name: /Segelclub/ }));
    expect(d.onSelectClub).toHaveBeenCalledWith("c2");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("MorePage (design: Menu)", () => {
  it("shows the working context and the further areas", () => {
    currentData = data();
    renderShell(<MorePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Mehr" })).toBeInTheDocument();
    expect(screen.getByText("Schützenverein Waldblick")).toBeInTheDocument();
    expect(screen.getByText("Schießbetrieb 2026")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Weitere Bereiche" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([
      "Vorlagen",
      "Termine importieren",
      "Einstellungen",
      "Verein verwalten",
      "Orte und Gruppen",
      "Alle Vereine",
      "Mein Profil",
    ]);
    expect(within(nav).getByRole("link", { name: "Alle Vereine" })).toHaveAttribute(
      "href",
      "/clubs?select=1",
    );
  });

  it("signs out with a real button", async () => {
    currentData = data();
    renderShell(<MorePage />);
    await userEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    expect(currentData.onLogout).toHaveBeenCalled();
  });
});
