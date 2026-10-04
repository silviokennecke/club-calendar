import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import MorePage from "../MorePage";
import type { ShellData } from "@/components/layout/shellTypes";

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ updateUser: vi.fn() }) }));

function renderMore(data: Partial<ShellData>) {
  const full: ShellData = {
    clubs: [],
    calendars: [],
    clubId: "c1",
    calendarId: null,
    userName: "Alex",
    onSelectClub: () => {},
    onLogout: () => {},
    ...data,
  };
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={full} />}>
          <Route index element={<MorePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("MorePage context", () => {
  it("says 'Nicht verfügbar' (not 'Laden…') for a club that cannot be loaded", () => {
    renderMore({ contextState: "unavailable" });
    expect(screen.getAllByText("Nicht verfügbar")).toHaveLength(2);
    expect(screen.queryByText("Laden…")).toBeNull();
  });

  it("says 'Laden…' while the context loads", () => {
    renderMore({ contextState: "loading" });
    expect(screen.getAllByText("Laden…")).toHaveLength(2);
  });
});
