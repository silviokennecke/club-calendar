import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HelpSubscribePage from "../HelpSubscribePage";
import { renderAt } from "./authTestUtils";
import * as platform from "@/lib/platform";

function renderHelp(search = "") {
  return renderAt(`/help/subscribe${search}`, "/help/subscribe", <HelpSubscribePage />);
}

afterEach(() => vi.restoreAllMocks());

describe("HelpSubscribePage", () => {
  it("shows the intro and only the selected guide", () => {
    renderHelp("?app=macos");
    expect(
      screen.getByRole("heading", { level: 1, name: "So abonnierst du den Kalender" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mac" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(/Neues Kalenderabonnement/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Kalenderabo hinzufügen/)).not.toBeInTheDocument();
  });

  it.each([
    ["ios", "iPhone / iPad"],
    ["macos", "Mac"],
    ["windows", "Outlook"],
    ["android", "Google Kalender"],
    ["other", "Google Kalender"],
  ] as const)("preselects by platform %s", (p, tab) => {
    vi.spyOn(platform, "detectPlatform").mockReturnValue(p);
    renderHelp();
    expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  });

  it("lets the query parameter win over the platform", () => {
    vi.spyOn(platform, "detectPlatform").mockReturnValue("ios");
    renderHelp("?app=outlook");
    expect(screen.getByRole("tab", { name: "Outlook" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches tabs by click and arrow keys and mirrors the query", async () => {
    const user = userEvent.setup();
    renderHelp("?app=ios");
    await user.click(screen.getByRole("tab", { name: "Google Kalender" }));
    expect(screen.getByRole("tab", { name: "Google Kalender" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Per URL");

    screen.getByRole("tab", { name: "Google Kalender" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "iPhone / iPad" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "iPhone / iPad" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("hides a step figure when its image fails to load", () => {
    renderHelp("?app=ios");
    const imgs = document.querySelectorAll("figure img");
    expect(imgs.length).toBe(7);
    expect(imgs[0]).toHaveAttribute("src", "/help/ios-1.png");
    expect(imgs[0]).toHaveAttribute("loading", "lazy");
    fireEvent.error(imgs[0]);
    expect(document.querySelectorAll("figure img").length).toBe(6);
  });
});
