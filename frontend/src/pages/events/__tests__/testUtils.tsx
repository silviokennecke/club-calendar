/* eslint-disable react-refresh/only-export-components -- test helpers, no fast refresh */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import type { CalendarEvent } from "@/lib/types";

export const BASE = "/clubs/c1/calendars/k1";
/** Route pattern of BASE (as in App.tsx). */
export const PATTERN = "/clubs/:clubId/calendars/:calendarId";

export const groups = [
  { id: "g1", calendarid: "k1", name: "Jugend" },
  { id: "g2", calendarid: "k1", name: "Erwachsene" },
];

export function makeEvent(
  partial: Partial<CalendarEvent> & { id: string; name: string; date: string },
): CalendarEvent {
  return {
    calendarId: "k1",
    dateEnd: null,
    timeBegin: "19:00",
    timeEnd: "21:00",
    isAllDay: false,
    timezone: null,
    isDraft: false,
    locationId: null,
    location: null,
    eventTemplateId: null,
    properties: [],
    features: [],
    targetGroups: [],
    ...partial,
  };
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

/** Renders one event route inside a router; other paths show a location probe. */
export function renderRoute(path: string, url: string, element: ReactElement, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: url.split("?")[0],
            search: url.includes("?") ? `?${url.split("?")[1]}` : "",
            state,
          },
        ]}
      >
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
