import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/shared";
import { MySubscriptionTab } from "../MySubscriptionTab";

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));

const subscription = {
  id: "s1",
  secret: "abc123",
  selectedFeedIds: ["f1"],
  targetGroupIds: [] as string[],
  updatedAt: "2026-11-09T10:00:00+00:00",
};
const feeds = {
  feeds: [
    {
      id: "f1",
      name: "Vereinstermine",
      visibility: "CLUB",
      calendarNames: ["Schießen"],
      accessReason: "club",
      selected: true,
    },
    {
      id: "f2",
      name: "Vorstand intern",
      visibility: "PRIVATE",
      calendarNames: ["Vorstand"],
      accessReason: "assigned",
      selected: false,
    },
  ],
  targetGroups: [
    { id: "g1", name: "Jugend" },
    { id: "g2", name: "Erwachsene" },
  ],
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MySubscriptionTab clubId="c1" />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  apiGet.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith("/my-feeds") ? feeds : subscription),
  );
});

describe("MySubscriptionTab", () => {
  it("lists the feeds with their state and shows the personal address", async () => {
    renderTab();
    const first = await screen.findByRole("checkbox", { name: /Vereinstermine/ });
    expect(first).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Vorstand intern/ })).not.toBeChecked();
    expect(screen.getByText(/Schießen/)).toBeInTheDocument();
    expect(screen.getByText(/Dir zugewiesen/)).toBeInTheDocument();
    expect(screen.getByText(/Private Feeds sind nicht öffentlich/)).toBeInTheDocument();
    expect((screen.getByLabelText("Persönlicher Link") as HTMLInputElement).value).toMatch(
      /\/api\/feed\/me\/s1\/ics\?secret=abc123$/,
    );
    expect(screen.getByText(/Keine Gruppe gewählt/)).toBeInTheDocument();
  });

  it("saves the chosen feeds and groups explicitly", async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValue({
      ...subscription,
      selectedFeedIds: ["f1", "f2"],
      targetGroupIds: ["g1"],
    });
    renderTab();
    const save = await screen.findByRole("button", { name: "Auswahl speichern" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Vorstand intern/ }));
    await user.click(screen.getByRole("button", { name: "Jugend" }));
    expect(
      screen.getByText(/nur Termine der gewählten Gruppen/i, { selector: ".cc-hint" }),
    ).toBeInTheDocument();
    await user.click(save);
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/api/clubs/c1/my-subscription", {
        feedIds: ["f1", "f2"],
        targetGroupIds: ["g1"],
      }),
    );
    expect(await screen.findByText("Dein Abo wurde gespeichert")).toBeInTheDocument();
  });

  it("discards changes and shows an error toast when saving fails", async () => {
    const user = userEvent.setup();
    apiPut.mockRejectedValue(new Error("boom"));
    renderTab();
    await user.click(await screen.findByRole("checkbox", { name: /Vereinstermine/ }));
    await user.click(screen.getByRole("button", { name: "Änderungen verwerfen" }));
    expect(screen.getByRole("checkbox", { name: /Vereinstermine/ })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Vereinstermine/ }));
    await user.click(screen.getByRole("button", { name: "Auswahl speichern" }));
    expect(await screen.findByText("Dein Abo konnte nicht gespeichert werden")).toBeInTheDocument();
  });

  it("allows saving an empty feed selection", async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValue({ ...subscription, selectedFeedIds: [] });
    renderTab();
    await user.click(await screen.findByRole("checkbox", { name: /Vereinstermine/ }));
    await user.click(screen.getByRole("button", { name: "Auswahl speichern" }));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/api/clubs/c1/my-subscription", {
        feedIds: [],
        targetGroupIds: [],
      }),
    );
  });
});
