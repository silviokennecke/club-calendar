import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SignedInBar } from "../SignedInBar";
import { AuthContext, type AuthContextValue } from "@/lib/auth-context";

const logout = vi.fn();

function renderBar(value: Partial<AuthContextValue> | null) {
  const ctx = value && ({ user: null, loading: false, logout, ...value } as AuthContextValue);
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={ctx}>
        <SignedInBar />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("SignedInBar", () => {
  it("renders nothing without a session or provider", () => {
    const { container, unmount } = renderBar({});
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(renderBar(null).container).toBeEmptyDOMElement();
  });

  it("shows the name with the links and signs out", async () => {
    renderBar({ user: { id: "u", name: "Alex", email: "a@b.de" } as never });
    expect(screen.getByRole("region", { name: "Konto" })).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu meinem Konto" })).toHaveAttribute("href", "/clubs");
    await userEvent.setup().click(screen.getByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
  });

  it("falls back to the e-mail address", () => {
    renderBar({ user: { id: "u", name: "", email: "a@b.de" } as never });
    expect(screen.getByText("a@b.de")).toBeInTheDocument();
  });

  it("holds the place while a returning session is checked", () => {
    sessionStorage.setItem("access_token", "t");
    renderBar({ loading: true });
    expect(screen.getByTestId("signed-in-bar-placeholder")).toBeInTheDocument();
  });

  it("shows no placeholder for a first-time visitor", () => {
    renderBar({ loading: true });
    expect(screen.queryByTestId("signed-in-bar-placeholder")).toBeNull();
  });
});
