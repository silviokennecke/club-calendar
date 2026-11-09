import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/shared";
import { CalendarSubscriptionSection } from "./CalendarSubscriptionSection";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarSubscriptionSection />
      <Toaster />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue([
    { id: "c1", name: "Schützenverein", role: "member" },
    { id: "c2", name: "Chor", role: "editor" },
  ]);
});

describe("CalendarSubscriptionSection", () => {
  it("lists the clubs with a renew button each", async () => {
    renderSection();
    expect(await screen.findByText("Schützenverein")).toBeInTheDocument();
    expect(screen.getByText("Chor")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Link erneuern" })).toHaveLength(2);
  });

  it("asks before renewing and shows the new link afterwards", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({
      id: "s9",
      secret: "newsecret",
      selectedFeedIds: [],
      targetGroupIds: [],
    });
    renderSection();
    await user.click((await screen.findAllByRole("button", { name: "Link erneuern" }))[0]!);
    expect(await screen.findByText(/funktioniert danach nicht mehr/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await user.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Link erneuern")!,
    );
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/my-subscription/rotate-secret", {}),
    );
    const field = (await screen.findByLabelText("Persönlicher Link")) as HTMLInputElement;
    expect(field.value).toMatch(/\/api\/feed\/me\/s9\/ics\?secret=newsecret$/);
  });

  it("keeps the old link when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click((await screen.findAllByRole("button", { name: "Link erneuern" }))[0]!);
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("renders nothing for a user without a club", async () => {
    apiGet.mockResolvedValue([]);
    const { container } = renderSection();
    await waitFor(() => expect(container.querySelector("#pr-subscription")).toBeNull());
  });
});
