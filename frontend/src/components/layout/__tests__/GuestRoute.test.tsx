import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GuestRoute from "../GuestRoute";

let auth: { user: unknown; loading: boolean } = { user: null, loading: false };
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<p>login form</p>} />
          <Route path="/signup" element={<p>signup form</p>} />
          <Route path="/forgot-password" element={<p>forgot form</p>} />
        </Route>
        <Route path="/clubs" element={<p>clubs page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GuestRoute", () => {
  it.each([
    ["/login", "login form"],
    ["/signup", "signup form"],
    ["/forgot-password", "forgot form"],
  ])("shows %s to signed-out visitors", (path, text) => {
    auth = { user: null, loading: false };
    renderAt(path);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each(["/login", "/signup", "/forgot-password"])(
    "redirects signed-in users from %s to /clubs",
    (path) => {
      auth = { user: { id: "u1" }, loading: false };
      renderAt(path);
      expect(screen.getByText("clubs page")).toBeInTheDocument();
    },
  );

  it("waits for the session check before deciding", () => {
    auth = { user: null, loading: true };
    renderAt("/login");
    expect(screen.queryByText("login form")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
