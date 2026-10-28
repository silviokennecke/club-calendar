import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../ProtectedRoute";

let auth: { user: unknown; loading: boolean };
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/pages/lazy", () => ({ ConsentPage: () => <div>consent-gate</div> }));
vi.mock("../AppShell", () => ({ AppShell: () => <div>shell</div> }));
vi.mock("@/components/legal/ConsentChangeBanner", () => ({ ConsentChangeBanner: () => null }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/clubs" element={<div>clubs</div>} />
        </Route>
        <Route path="/verify-email" element={<div>verify-page</div>} />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute verify gate", () => {
  it("sends a restricted session to the verify page, before the consent gate", () => {
    auth = {
      user: { id: "u", emailVerificationRequired: true, consentRequired: true },
      loading: false,
    };
    renderAt("/clubs");
    expect(screen.getByText("verify-page")).toBeInTheDocument();
  });

  it("lets a confirmed user pass", () => {
    auth = { user: { id: "u", emailVerificationRequired: false }, loading: false };
    renderAt("/clubs");
    expect(screen.getByText("clubs")).toBeInTheDocument();
  });
});
