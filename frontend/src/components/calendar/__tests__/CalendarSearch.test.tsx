import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarSearch } from "../CalendarSearch";

const apiGetWithTotal = vi.fn();

const event = (id: string, name: string) => ({
  id,
  name,
  date: "2026-10-08",
  timeBegin: "19:00:00",
  timeEnd: "21:00:00",
  isDraft: false,
  location: { id: "l1", name: "Schützenhaus" },
});

function setup(onPick = vi.fn(), onShowAll = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CalendarSearch
        scope={["events", "c1"]}
        search={(q) => apiGetWithTotal(`/api/calendars/c1/events?q=${q}&limit=10`)}
        onPick={onPick}
        onShowAll={onShowAll}
        placeholder="Suche"
      />
    </QueryClientProvider>,
  );
  return { onPick, onShowAll, user: userEvent.setup() };
}

describe("CalendarSearch", () => {
  beforeEach(() => apiGetWithTotal.mockReset());

  it("does not search below two characters", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "T");
    await new Promise((r) => setTimeout(r, 350));
    expect(apiGetWithTotal).not.toHaveBeenCalled();
  });

  it("lists matches, shows the overflow note and picks with the keyboard", async () => {
    apiGetWithTotal.mockResolvedValue({ data: [event("e1", "Training")], total: 25 });
    const { user, onPick } = setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "Tra");
    const option = await screen.findByRole("option", { name: /Training/ });
    expect(option).toHaveTextContent("Schützenhaus");
    expect(apiGetWithTotal.mock.calls[0][0]).toBe("/api/calendars/c1/events?q=Tra&limit=10");
    expect(await screen.findByText(/1 von 25 Treffern/)).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
    await waitFor(() => expect(input).toHaveAttribute("aria-expanded", "false"));
  });

  it("marks draft results", async () => {
    apiGetWithTotal.mockResolvedValue({
      data: [{ ...event("e1", "Entwurf"), isDraft: true }, event("e2", "Fest")],
      total: 2,
    });
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "Fe");
    const draft = await screen.findByRole("option", { name: /Entwurf/ });
    expect(draft.querySelector('[data-status="draft"]')).not.toBeNull();
    expect(screen.getByRole("option", { name: /Fest/ }).querySelector("[data-status]")).toBeNull();
  });

  it("shows the empty state and closes with Escape", async () => {
    apiGetWithTotal.mockResolvedValue({ data: [], total: 0 });
    const { user } = setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "Sommerfest");
    expect(await screen.findByText("Keine Termine zu „Sommerfest“ gefunden")).toBeVisible();
    expect(screen.getByRole("option", { name: "Alle Ergebnisse anzeigen" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("always offers 'show all results' last and opens the list with the term", async () => {
    apiGetWithTotal.mockResolvedValue({ data: [event("e1", "Training")], total: 1 });
    const { user, onShowAll, onPick } = setup();
    await user.type(screen.getByRole("combobox"), "Tra");
    await screen.findByRole("option", { name: /Training/ });
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveTextContent("Alle Ergebnisse anzeigen");
    await user.click(options[options.length - 1]);
    expect(onShowAll).toHaveBeenCalledWith("Tra");
    expect(onPick).not.toHaveBeenCalled();
  });
});
