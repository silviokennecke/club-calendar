import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarPermissions } from "../CalendarPermissions";

const apiGet = vi.fn();
const apiGetWithTotal = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", async () => {
  class ApiError extends Error {
    status = 422;
    code?: string;
    constructor(code?: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    ApiError,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiGetWithTotal: (...a: unknown[]) => apiGetWithTotal(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
  };
});

const anna = {
  userId: "u1",
  name: "Anna Muster",
  email: "anna@example.org",
  clubRole: "member",
  createdAt: "2026-11-01T10:00:00Z",
};

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarPermissions clubId="c1" calendarId="k1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [apiGet, apiGetWithTotal, apiPost, apiDelete]) fn.mockReset();
  apiGet.mockResolvedValue([anna]);
  apiGetWithTotal.mockResolvedValue({
    data: [
      { id: "u1", name: "Anna Muster", email: "anna@example.org", role: "member" },
      { id: "u2", name: "Ben Beispiel", email: "ben@example.org", role: "editor" },
    ],
    total: 2,
  });
  apiPost.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

describe("CalendarPermissions", () => {
  it("lists the people with a permission and explains what it allows", async () => {
    renderIt();
    expect(await screen.findByText("anna@example.org")).toBeInTheDocument();
    expect(screen.getByText(/dürfen in diesem Kalender Termine, Serien, Vorlagen/)).toBeVisible();
  });

  it("offers only club members that are not added yet (with e-mail and role) and adds one", async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByText("anna@example.org");
    await user.type(screen.getByRole("combobox", { name: /Vereinsmitglied hinzufügen/ }), "Be");
    const option = await screen.findByRole("option", { name: /Ben Beispiel/ });
    expect(option).toHaveTextContent("ben@example.org");
    expect(option).toHaveTextContent("Bearbeiter");
    expect(screen.queryByRole("option", { name: /Anna Muster/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeDisabled();
    await user.click(option);
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/members", { userId: "u2" }),
    );
  });

  it("removes a permission after a confirmation", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole("button", { name: /Berechtigung von Anna Muster/ }));
    await user.click(await screen.findByRole("button", { name: "Berechtigung entfernen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/members/u1"));
  });
});
