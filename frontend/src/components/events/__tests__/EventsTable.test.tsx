import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventsTable, EVENTS_PAGE_SIZE } from "../EventsTable";
import type { CalendarEvent } from "@/lib/types";

function makeEvents(n: number): CalendarEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    name: `Termin ${i}`,
    date: "2026-03-10",
    dateEnd: "2026-03-10",
    timeBegin: "10:00:00",
    timeEnd: "11:00:00",
    isAllDay: false,
    isDraft: false,
    seriesId: null,
    location: null,
    properties: [],
    features: [],
    targetGroups: [],
  })) as unknown as CalendarEvent[];
}

describe("EventsTable windowing", () => {
  it("renders the first page and reveals more on demand; select-all covers all events", () => {
    const events = makeEvents(EVENTS_PAGE_SIZE + 50);
    const selected = new Set(events.map((e) => e.id));
    render(
      <MemoryRouter>
        <EventsTable
          events={events}
          caption="Termine"
          hrefOf={(e) => `/e/${e.id}`}
          toneOf={() => "brand" as never}
          selected={selected}
          onToggle={() => {}}
          onToggleAll={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(EVENTS_PAGE_SIZE);
    const all = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(all.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /50 weitere/ }));
    expect(screen.getAllByRole("link")).toHaveLength(EVENTS_PAGE_SIZE + 50);
    expect(screen.queryByRole("button", { name: /weitere/ })).toBeNull();
  });
});
