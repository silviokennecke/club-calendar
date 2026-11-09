import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MyCalendarTab } from "../MyCalendarTab";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));

let subscription: { selectedFeedIds: string[]; targetGroupIds: string[] };
let eventCount: number;
const today = new Date().toISOString().slice(0, 10);

const feeds = {
  feeds: [],
  targetGroups: [
    { id: "g1", name: "Jugend" },
    { id: "g2", name: "Erwachsene" },
  ],
};

function eventsBody() {
  return {
    feed: {
      id: "s1",
      name: "Mein Abo",
      clubName: "Schützenverein",
      timezone: "Europe/Berlin",
      visibility: "PRIVATE",
      indexable: false,
      eventCount,
      audiences: [],
    },
    events:
      eventCount === 0
        ? []
        : [
            {
              id: "e1",
              name: "Jugendtraining",
              date: today,
              dateEnd: null,
              timeBegin: "18:00",
              timeEnd: "19:00",
              properties: [],
              features: [],
              targetGroups: [{ targetGroup: { id: "g1", name: "Jugend" } }],
            },
          ],
    holidays: [],
  };
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderTab(path = "/clubs/c1/me") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MyCalendarTab clubId="c1" />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  subscription = { selectedFeedIds: ["f1"], targetGroupIds: [] };
  eventCount = 1;
  apiGet.mockImplementation((path: string) => {
    if (path.includes("/my-events")) return Promise.resolve(eventsBody());
    if (path.endsWith("/my-feeds")) return Promise.resolve(feeds);
    return Promise.resolve({ id: "s1", secret: "x", updatedAt: "", ...subscription });
  });
});

const eventsCalls = () =>
  apiGet.mock.calls.map((c) => String(c[0])).filter((p) => p.includes("/my-events"));

describe("MyCalendarTab", () => {
  it("points to the subscription tab when no feed is selected", async () => {
    subscription = { selectedFeedIds: [], targetGroupIds: [] };
    renderTab();
    expect(await screen.findByText("Noch keine Feeds ausgewählt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Feeds auswählen" })).toHaveAttribute(
      "href",
      "/clubs/c1/me?tab=subscription",
    );
  });

  it("says so when the selected feeds have no events", async () => {
    eventCount = 0;
    renderTab();
    expect(await screen.findByText("Noch keine Termine")).toBeInTheDocument();
  });

  it("shows the events and uses the subscription's audiences without sending them", async () => {
    subscription = { selectedFeedIds: ["f1"], targetGroupIds: ["g1"] };
    renderTab();
    expect(await screen.findByText("Jugendtraining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jugend", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erwachsene", pressed: false })).toBeInTheDocument();
    expect(screen.getByText(/Aus deinem Abo vorausgewählt/)).toBeInTheDocument();
    expect(eventsCalls().every((p) => !p.includes("targetGroupIds"))).toBe(true);
  });

  it("changes the filter in the view only and asks the server with the new selection", async () => {
    const user = userEvent.setup();
    subscription = { selectedFeedIds: ["f1"], targetGroupIds: ["g1"] };
    renderTab();
    await screen.findByText("Jugendtraining");
    await user.click(screen.getByRole("button", { name: "Erwachsene" }));
    await waitFor(() =>
      expect(eventsCalls().some((p) => p.includes("targetGroupIds=g1%2Cg2"))).toBe(true),
    );
    expect(screen.queryByText(/Aus deinem Abo vorausgewählt/)).not.toBeInTheDocument();
    expect(apiGet.mock.calls.every((c) => !String(c[0]).includes("PUT"))).toBe(true);
  });

  it("an empty selection sent explicitly means all audiences", async () => {
    const user = userEvent.setup();
    subscription = { selectedFeedIds: ["f1"], targetGroupIds: ["g1"] };
    renderTab();
    await screen.findByText("Jugendtraining");
    await user.click(screen.getByRole("button", { name: "Jugend" }));
    await waitFor(() =>
      expect(eventsCalls().some((p) => /targetGroupIds=(&|$)/.test(p))).toBe(true),
    );
  });

  it("opens the event details as a routed dialog", async () => {
    const user = userEvent.setup();
    renderTab("/clubs/c1/me?view=list");
    await user.click(await screen.findByRole("button", { name: /Jugendtraining/ }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/clubs/c1/me/events/e1");
  });
});
