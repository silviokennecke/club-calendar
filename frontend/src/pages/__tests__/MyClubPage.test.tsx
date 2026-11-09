import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import MyClubPage from "../MyClubPage";
import type { ShellData } from "@/components/layout/shellTypes";

const apiDelete = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/api", () => ({
  apiDelete: (...a: unknown[]) => apiDelete(...a),
  apiGet: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" }, updateUser }),
}));

const data: ShellData = {
  clubs: [{ id: "c1", name: "Schützenverein", timezone: "Europe/Berlin", role: "member" }],
  calendars: [],
  clubId: "c1",
  calendarId: null,
  userName: "Alex",
  onSelectClub: vi.fn(),
  onLogout: vi.fn(),
};

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={data} />}>
            <Route
              path="/clubs/:clubId/me"
              element={
                <>
                  <MyClubPage />
                  <Probe />
                </>
              }
            />
          </Route>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiDelete.mockReset();
  updateUser.mockReset();
  updateUser.mockResolvedValue(true);
});

describe("MyClubPage", () => {
  it("shows the calendar tab first and switches tabs through the URL", async () => {
    renderAt("/clubs/c1/me");
    expect(screen.getByRole("tab", { name: "Kalender", selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Abo" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/clubs/c1/me?tab=subscription");
    expect(screen.getByRole("tab", { name: "Abo", selected: true })).toBeInTheDocument();
  });

  it("opens the tab named in the URL", () => {
    renderAt("/clubs/c1/me?tab=subscription");
    expect(screen.getByRole("tab", { name: "Abo", selected: true })).toBeInTheDocument();
  });

  it("lets a member leave the club", async () => {
    apiDelete.mockResolvedValue(undefined);
    renderAt("/clubs/c1/me");
    await userEvent.click(screen.getByRole("button", { name: "Verein verlassen" }));
    await userEvent.click(
      await screen
        .findByRole("button", { name: "Verein verlassen", hidden: false })
        .then(() => screen.getAllByRole("button", { name: "Verein verlassen" }).at(-1)!),
    );
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/members/u1"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/clubs?select=1"));
    expect(updateUser).toHaveBeenCalledWith({ lastClubId: null, lastCalendarId: null });
  });

  it("stays on the page when the club would have no member left", async () => {
    apiDelete.mockRejectedValue(Object.assign(new Error("x"), { code: "last_member" }));
    renderAt("/clubs/c1/me");
    await userEvent.click(screen.getByRole("button", { name: "Verein verlassen" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Verein verlassen" }).at(-1)!);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(screen.getByTestId("loc")).toHaveTextContent("/clubs/c1/me");
    expect(updateUser).not.toHaveBeenCalled();
  });
});
