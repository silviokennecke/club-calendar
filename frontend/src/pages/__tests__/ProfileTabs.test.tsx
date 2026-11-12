import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/lib/ThemeProvider";
import ProfilePage from "../ProfilePage";
import ProfileAccountTab from "../profile/ProfileAccountTab";
import ProfileSecurityTab from "../profile/ProfileSecurityTab";
import ProfileAppsTab from "../profile/ProfileAppsTab";
import ProfilePrivacyTab from "../profile/ProfilePrivacyTab";
import { useScrollToHash } from "@/lib/profile/useScrollToHash";

const apiGet = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Alex Beispiel", email: "alex@beispiel.de" },
    updateUser: vi.fn(),
    logout: vi.fn(),
    login: vi.fn(),
  }),
}));
// The tab bodies are covered by ProfilePage.test.tsx; here only routing matters.
vi.mock("@/components/profile/AccountSection", () => ({ AccountSection: () => null }));
vi.mock("@/components/profile/PreferencesSection", () => ({
  PreferencesSection: () => <h2>Prefs</h2>,
}));
vi.mock("@/components/profile/PasswordSection", () => ({ PasswordSection: () => null }));
vi.mock("@/components/profile/LinkedLoginsSection", () => ({ LinkedLoginsSection: () => null }));
vi.mock("@/components/profile/MfaSection", () => ({ MfaSection: () => null }));
vi.mock("@/components/profile/SessionsSection", () => ({
  SessionsSection: () => <h2>Sessions</h2>,
}));
vi.mock("@/components/profile/CalendarSubscriptionSection", () => ({
  CalendarSubscriptionSection: () => <h2>Subscription</h2>,
}));
vi.mock("@/components/profile/ConnectedAppsSection", () => ({
  ConnectedAppsSection: () => null,
}));
vi.mock("@/components/profile/LegalSection", () => ({ LegalSection: () => <h2>Legal</h2> }));
vi.mock("@/components/profile/DangerSection", () => ({ DangerSection: () => null }));

function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="where">{pathname + search + hash}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/profile"
              element={
                <>
                  <ProfilePage />
                  <Where />
                </>
              }
            >
              <Route index element={<ProfileAccountTab />} />
              <Route path="security" element={<ProfileSecurityTab />} />
              <Route path="apps" element={<ProfileAppsTab />} />
              <Route path="privacy" element={<ProfilePrivacyTab />} />
              <Route path="*" element={<Navigate to="/profile" replace />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const where = () => screen.getByTestId("where");

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({
    id: "u1",
    name: "Alex Beispiel",
    email: "alex@beispiel.de",
    hasPassword: true,
    passkeys: [],
    oauthAccounts: [],
    mfa: { enforced: false, totp: null, backupCodes: null, canEnforce: true },
  });
});

describe("profile tabs", () => {
  it("shows four tabs and marks only the current one", async () => {
    renderAt("/profile/apps");
    const nav = await screen.findByRole("navigation", { name: "Profilbereiche" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual([
      "Konto",
      "Sicherheit",
      "Kalender & Apps",
      "Datenschutz",
    ]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/profile",
      "/profile/security",
      "/profile/apps",
      "/profile/privacy",
    ]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, null, "page", null]);
  });

  it("navigates between the tabs and moves aria-current", async () => {
    const user = userEvent.setup();
    renderAt("/profile");
    expect(await screen.findByRole("heading", { name: "Prefs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Konto" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("link", { name: "Sicherheit" }));
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(where()).toHaveTextContent("/profile/security");
    expect(screen.getByRole("link", { name: "Sicherheit" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Konto" })).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("link", { name: "Datenschutz" }));
    expect(await screen.findByRole("heading", { name: "Legal" })).toBeInTheDocument();
    expect(where()).toHaveTextContent("/profile/privacy");
    expect(screen.queryByRole("heading", { name: "Sessions" })).not.toBeInTheDocument();
  });

  it("treats a trailing slash as the same tab", async () => {
    renderAt("/profile/security/");
    expect(await screen.findByRole("link", { name: "Sicherheit" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("forwards an old /profile#pr-pw link to the security tab and keeps the hash", async () => {
    renderAt("/profile#pr-pw");
    await waitFor(() => expect(where()).toHaveTextContent("/profile/security#pr-pw"));
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
  });

  it.each([
    ["#pr-subscription", "/profile/apps"],
    ["#pr-danger", "/profile/privacy"],
  ])("forwards %s to %s", async (hash, target) => {
    renderAt("/profile" + hash);
    await waitFor(() => expect(where()).toHaveTextContent(target + hash));
  });

  it("keeps #pr-set and an unknown hash on the account tab", async () => {
    renderAt("/profile#pr-set");
    expect(await screen.findByRole("heading", { name: "Prefs" })).toBeInTheDocument();
    expect(where()).toHaveTextContent("/profile#pr-set");
  });

  it("forwards the SSO link return to the security tab and keeps the query", async () => {
    renderAt("/profile?link_error=x");
    await waitFor(() => expect(where()).toHaveTextContent("/profile/security"));
    // The security tab shows the result once and then removes the parameters itself.
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
  });

  it("goes to the account tab for an unknown sub path", async () => {
    renderAt("/profile/nope");
    await waitFor(() => expect(where()).toHaveTextContent(/^\/profile$/));
    expect(await screen.findByRole("heading", { name: "Prefs" })).toBeInTheDocument();
  });
});

describe("useScrollToHash", () => {
  function Target({ ready }: { ready?: boolean }) {
    useScrollToHash(ready);
    return <div id="pr-x">target</div>;
  }
  function renderHash(hash: string, ready = true) {
    return render(
      <MemoryRouter initialEntries={["/profile/security" + hash]}>
        <Target ready={ready} />
      </MemoryRouter>,
    );
  }

  it("focuses and scrolls to the element of the hash", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderHash("#pr-x");
    const el = document.getElementById("pr-x")!;
    await waitFor(() => expect(el).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
    expect(el).toHaveClass("ap-focus-target");
    expect(el).toHaveAttribute("tabindex", "-1");
  });

  it("does nothing without a hash or while not ready", () => {
    renderHash("");
    expect(document.getElementById("pr-x")).not.toHaveFocus();
    renderHash("#pr-x", false);
    expect(document.getElementById("pr-x")).not.toHaveFocus();
  });
});
