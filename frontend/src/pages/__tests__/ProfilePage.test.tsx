import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { Toaster } from "@/components/ui/shared";
import i18n from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import ProfilePage from "../ProfilePage";
import ProfileAccountTab from "../profile/ProfileAccountTab";
import ProfileSecurityTab from "../profile/ProfileSecurityTab";
import ProfileAppsTab from "../profile/ProfileAppsTab";
import ProfilePrivacyTab from "../profile/ProfilePrivacyTab";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
const apiFetch = vi.fn();
const logoutEverywhere = vi.fn();
const updateUser = vi.fn();
const logout = vi.fn();
const login = vi.fn();
const startRegistration = vi.fn();
let authUser: Record<string, unknown>;

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  logoutEverywhere: (...a: unknown[]) => logoutEverywhere(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: authUser, updateUser, logout, login }),
}));
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...a: unknown[]) => startRegistration(...a),
}));

let profile: Record<string, unknown>;
let providers: unknown[];

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}
function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="search">{loc.search}</div>;
}
function ShellStub() {
  return <Outlet context={{}} />;
}

// Mirrors the nested routes of App.tsx: layout at /profile, one child route per tab.
function renderProfile(inShell = true, path = "/profile") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <ProfilePage />
      <SearchProbe />
    </>
  );
  const tabs = (
    <>
      <Route index element={<ProfileAccountTab />} />
      <Route path="security" element={<ProfileSecurityTab />} />
      <Route path="apps" element={<ProfileAppsTab />} />
      <Route path="privacy" element={<ProfilePrivacyTab />} />
      <Route path="*" element={<Navigate to="/profile" replace />} />
    </>
  );
  return render(
    <ThemeProvider>
      <Toaster />
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {inShell ? (
              <Route element={<ShellStub />}>
                <Route path="/profile" element={page}>
                  {tabs}
                </Route>
              </Route>
            ) : (
              <Route path="/profile" element={page}>
                {tabs}
              </Route>
            )}
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  authUser = {
    id: "u1",
    name: "Alex Beispiel",
    email: "alex@beispiel.de",
    dateFormat: "dd.MM.yyyy",
    firstDayOfWeek: 1,
    language: "de",
  };
  profile = {
    id: "u1",
    name: "Alex Beispiel",
    email: "alex@beispiel.de",
    hasPassword: true,
    pendingEmail: null,
    passkeys: [
      {
        id: "p1",
        deviceName: "MacBook Alex",
        createdAt: "2026-03-12T09:00:00+00:00",
        lastUsedAt: "2026-10-01T12:00:00+00:00",
      },
      {
        id: "p2",
        deviceName: "iPhone Alex",
        createdAt: "2026-09-08T09:00:00+00:00",
        lastUsedAt: null,
      },
    ],
    oauthAccounts: [{ provider: "google" }],
    mfa: { enforced: false, totp: null, backupCodes: null, canEnforce: true },
  };
  providers = [
    { id: "google", name: "Google", icon: "google" },
    { id: "microsoft", name: "Microsoft", icon: "microsoft" },
  ];
  for (const fn of [
    apiGet,
    apiPost,
    apiDelete,
    apiFetch,
    logoutEverywhere,
    updateUser,
    logout,
    login,
    startRegistration,
  ])
    fn.mockReset();
  apiPost.mockResolvedValue(undefined);
  updateUser.mockResolvedValue(true);
  apiDelete.mockResolvedValue(undefined);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/auth/me") return Promise.resolve(profile);
    if (path === "/api/auth/providers") return Promise.resolve(providers);
    if (path === "/api/auth/mcp-grants" || path === "/api/clubs") return Promise.resolve([]);
    return Promise.reject(new Error("unexpected " + path));
  });
  Object.defineProperty(window, "PublicKeyCredential", {
    value: function () {},
    configurable: true,
  });
  window.localStorage.clear();
});

// The language switch changes the UI language of the whole test run: put German back.
afterEach(async () => {
  await i18n.changeLanguage("de");
});

describe("ProfilePage", () => {
  it("shows the account, linked sign-ins as words and the passkeys", async () => {
    renderProfile(true, "/profile/security");
    expect(await screen.findByRole("heading", { level: 1, name: "Profil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Alex Beispiel" })).toBeInTheDocument();
    expect(screen.getByText("alex@beispiel.de")).toBeInTheDocument();
    expect(screen.queryByText(/noch nicht geändert werden/)).not.toBeInTheDocument();

    const sso = (await screen.findByRole("heading", { name: "Verknüpfte Anmeldungen" })).closest(
      "section",
    )!;
    await within(sso).findByText("Microsoft");
    const rows = within(sso).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Google");
    expect(rows[0]).toHaveTextContent("Verbunden");
    expect(rows[1]).toHaveTextContent("Microsoft");
    expect(rows[1]).toHaveTextContent("Nicht verbunden");
    // A password remains: both actions are available.
    expect(within(sso).getByRole("button", { name: "Google-Verknüpfung trennen" })).toBeEnabled();
    expect(within(sso).getByRole("button", { name: "Microsoft-Konto verknüpfen" })).toBeEnabled();
    expect(within(sso).queryByText(/Mindestens eine Anmeldemethode/)).not.toBeInTheDocument();

    const keys = within(screen.getByRole("list", { name: "Deine MFA-Methoden" })).getAllByRole(
      "listitem",
    );
    expect(keys[0]).toHaveTextContent("MacBook Alex");
    expect(keys[0]).toHaveTextContent("hinzugefügt am 12.03.2026 · zuletzt benutzt am 01.10.2026");
    expect(keys[1]).toHaveTextContent("noch nicht benutzt");
  });

  it("starts linking a provider with a one-time URL from the API", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, assign },
      configurable: true,
    });
    apiPost.mockResolvedValue({
      url: "http://localhost:3001/api/auth/oauth/microsoft/link?ticket=x",
    });
    const user = userEvent.setup();
    try {
      renderProfile(true, "/profile/security");
      await user.click(await screen.findByRole("button", { name: "Microsoft-Konto verknüpfen" }));
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          "http://localhost:3001/api/auth/oauth/microsoft/link?ticket=x",
        ),
      );
      expect(apiPost).toHaveBeenCalledWith("/api/auth/oauth/microsoft/link-start", {});
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
    }
  });

  it("unlinks a provider only after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderProfile(true, "/profile/security");
    await user.click(await screen.findByRole("button", { name: "Google-Verknüpfung trennen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Verknüpfung mit Google trennen?",
    });
    expect(dialog).toHaveTextContent("Mit Google kannst du dich danach nicht mehr anmelden.");
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Verknüpfung trennen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/oauth/google"));
    expect(
      await screen.findByText("Die Verknüpfung mit Google wurde getrennt."),
    ).toBeInTheDocument();
  });

  it("stays silent when the step-up confirmation for link-start is cancelled", async () => {
    apiPost.mockRejectedValueOnce(new ApiError("x", 0, "step_up_cancelled"));
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, assign },
      configurable: true,
    });
    const user = userEvent.setup();
    try {
      renderProfile(true, "/profile/security");
      await user.click(await screen.findByRole("button", { name: "Microsoft-Konto verknüpfen" }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
      expect(assign).not.toHaveBeenCalled();
      expect(screen.queryByText(/konnte nicht gestartet werden/)).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Microsoft-Konto verknüpfen" })).toBeEnabled(),
      );
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
    }
  });

  it("keeps the link proof when the step-up for link-complete is cancelled and retries", async () => {
    apiPost
      .mockRejectedValueOnce(new ApiError("x", 0, "step_up_cancelled"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderProfile(true, "/profile/security?link_provider=google&link_proof=proof-value");
    expect(await screen.findByText(/noch nicht abgeschlossen/)).toBeInTheDocument();
    expect(screen.queryByText("Das Konto wurde nicht verknüpft")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Erneut bestätigen" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost).toHaveBeenLastCalledWith("/api/auth/oauth/google/link-complete", {
      proof: "proof-value",
    });
    expect((await screen.findAllByText("Google wurde verknüpft.")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
  });

  it("stays silent when the step-up for unlinking is cancelled", async () => {
    apiDelete.mockRejectedValueOnce(new ApiError("x", 0, "step_up_cancelled"));
    const user = userEvent.setup();
    renderProfile(true, "/profile/security");
    await user.click(await screen.findByRole("button", { name: "Google-Verknüpfung trennen" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Verknüpfung trennen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/oauth/google"));
    expect(screen.queryByText(/konnte nicht getrennt werden/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Die Verknüpfung mit Google wurde getrennt."),
    ).not.toBeInTheDocument();
  });

  it("lets an account without a password request an e-mail change", async () => {
    profile = { ...profile, hasPassword: false };
    const user = userEvent.setup();
    renderProfile(true, "/profile");
    await user.type(await screen.findByLabelText(/^Neue E-Mail-Adresse/), "neu@beispiel.de");
    await user.click(screen.getByRole("button", { name: "Bestätigungslink senden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/change-email", { email: "neu@beispiel.de" }),
    );
  });

  it("keeps the last sign-in method: unlink disabled with an explanation", async () => {
    profile = { ...profile, hasPassword: false, passkeys: [] };
    renderProfile(true, "/profile/security");
    const unlink = await screen.findByRole("button", { name: "Google-Verknüpfung trennen" });
    expect(unlink).toBeDisabled();
    expect(unlink).toHaveAccessibleDescription(/Mindestens eine Anmeldemethode muss bleiben/);
  });

  it("shows the result of the link flow once and removes it from the address", async () => {
    renderProfile(true, "/profile/security?linked=google");
    const sso = (await screen.findByRole("heading", { name: "Verknüpfte Anmeldungen" })).closest(
      "section",
    )!;
    expect(within(sso).getByRole("status")).toHaveTextContent("Google wurde verknüpft.");
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
  });

  it("completes a link flow with this session and removes the proof from the address", async () => {
    apiPost.mockResolvedValueOnce(undefined);
    renderProfile(true, "/profile/security?link_provider=google&link_proof=proof-value");
    const sso = (await screen.findByRole("heading", { name: "Verknüpfte Anmeldungen" })).closest(
      "section",
    )!;
    await waitFor(() =>
      expect(within(sso).getByRole("status")).toHaveTextContent("Google wurde verknüpft."),
    );
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/api/auth/oauth/google/link-complete", {
      proof: "proof-value",
    });
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
  });

  it("shows a refused link completion (flow started by another account) as an error", async () => {
    apiPost.mockRejectedValueOnce(new ApiError("x", 400, "invalid_state"));
    renderProfile(true, "/profile/security?link_provider=google&link_proof=proof-value");
    expect(await screen.findByText("Das Konto wurde nicht verknüpft")).toBeInTheDocument();
    expect(screen.queryByText("Google wurde verknüpft.")).not.toBeInTheDocument();
  });

  it("explains a failed link by its code", async () => {
    renderProfile(true, "/profile/security?link_error=account_in_use");
    expect(await screen.findByText("Das Konto wurde nicht verknüpft")).toBeInTheDocument();
    expect(
      screen.getByText("Dieses Konto ist schon mit einem anderen Konto verknüpft."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
  });

  it("renames the account", async () => {
    const user = userEvent.setup();
    renderProfile(true, "/profile");
    const name = await screen.findByRole("textbox", { name: /^Name/ });
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Name speichern" }));
    expect(await screen.findByText("Bitte gib deinen Namen ein.")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
    await user.type(name, "  Alex B.  ");
    await user.click(screen.getByRole("button", { name: "Name speichern" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ name: "Alex B." }));
    expect(await screen.findByText("Name gespeichert")).toBeInTheDocument();
  });

  it("changes the password and continues the session with the new tokens", async () => {
    const tokens = { access_token: "a2", refresh_token: "r2", user: { id: "u1" } };
    apiPost.mockImplementation((path: string) =>
      path === "/api/auth/change-password" ? Promise.resolve(tokens) : Promise.resolve(undefined),
    );
    const user = userEvent.setup();
    renderProfile(true, "/profile/security");
    const panel = (await screen.findByRole("heading", { level: 2, name: "Passwort" })).closest(
      "section",
    )!;
    await user.type(within(panel).getByLabelText(/^Neues Passwort/), "short");
    await user.click(within(panel).getByRole("button", { name: "Passwort ändern" }));
    expect(await within(panel).findByText(/Das Passwort ist zu kurz/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();

    await user.type(within(panel).getByLabelText(/^Neues Passwort/), "-and-longer");
    await user.type(within(panel).getByLabelText(/^Passwort wiederholen/), "short-and-longer");
    await user.click(within(panel).getByRole("button", { name: "Passwort ändern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/change-password", {
        newPassword: "short-and-longer",
      }),
    );
    expect(login).toHaveBeenCalledWith("a2", "r2", { id: "u1" });
    expect(await screen.findByText(/Passwort geändert/)).toBeInTheDocument();
  });

  it("lets SSO-only accounts set a password by e-mail", async () => {
    profile = { ...profile, hasPassword: false };
    const user = userEvent.setup();
    renderProfile(true, "/profile/security");
    await user.click(await screen.findByRole("button", { name: "Passwort per E-Mail festlegen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/forgot-password", {
        email: "alex@beispiel.de",
      }),
    );
    expect(await screen.findByText("Prüfe dein Postfach")).toBeInTheDocument();
  });

  it("requests a new e-mail address (step-up confirmation by the API layer) and shows the pending change", async () => {
    const user = userEvent.setup();
    renderProfile(true, "/profile");
    await user.type(await screen.findByLabelText(/^Neue E-Mail-Adresse/), "neu@beispiel.de");
    profile = { ...profile, pendingEmail: "neu@beispiel.de" };
    await user.click(screen.getByRole("button", { name: "Bestätigungslink senden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/change-email", {
        email: "neu@beispiel.de",
      }),
    );
    expect(await screen.findByText("Neue Adresse wartet auf Bestätigung")).toBeInTheDocument();
    profile = { ...profile, pendingEmail: null };
    await user.click(screen.getByRole("button", { name: "Änderung verwerfen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/change-email"));
    await waitFor(() =>
      expect(screen.queryByText("Neue Adresse wartet auf Bestätigung")).not.toBeInTheDocument(),
    );
  });

  it("works without the app shell (no club yet) with a way back", async () => {
    renderProfile(false, "/profile/security");
    expect(await screen.findByRole("heading", { level: 1, name: "Profil" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu allen Vereinen" })).toHaveAttribute(
      "href",
      "/clubs?select=1",
    );
    expect(
      await screen.findByRole("heading", { name: "Multi-Faktor-Authentifizierung (MFA)" }),
    ).toBeInTheDocument();
  });

  it("signs out", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
  });

  it("saves the date format, first weekday and language on the account", async () => {
    const user = userEvent.setup();
    renderProfile(true, "/profile");
    const prefs = (
      await screen.findByRole("heading", { name: "Persönliche Einstellungen" })
    ).closest("section")!;
    expect(within(prefs).getByRole("radio", { name: "31.12.2026" })).toBeChecked();
    await user.click(within(prefs).getByRole("radio", { name: "2026-12-31" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ dateFormat: "yyyy-MM-dd" }));

    const monday = within(prefs).getByRole("button", { name: "Montag" });
    expect(monday).toHaveAttribute("aria-pressed", "true");
    await user.click(within(prefs).getByRole("button", { name: "Sonntag" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ firstDayOfWeek: 0 }));

    await user.click(within(prefs).getByRole("button", { name: "English" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ language: "en" }));
  });

  it("reports a failed save", async () => {
    updateUser.mockResolvedValue(false);
    const user = userEvent.setup();
    renderProfile(true, "/profile");
    await user.click(await screen.findByRole("radio", { name: "2026-12-31" }));
    expect(
      await screen.findByText(
        "Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
  });

  it("switches the theme and remembers it in this browser", async () => {
    const user = userEvent.setup();
    renderProfile(true, "/profile");
    const group = (await screen.findByText("Darstellung")).closest('[role="group"]') as HTMLElement;
    const system = within(group).getByRole("button", { name: "Wie System" });
    expect(system).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "Dunkel" }));
    expect(within(group).getByRole("button", { name: "Dunkel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    // Theme is a browser setting: nothing is sent to the account.
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("signs out everywhere only after confirming, then signs out locally", async () => {
    const user = userEvent.setup();
    logoutEverywhere.mockResolvedValue(undefined);
    renderProfile(true, "/profile/security");
    await user.click(await screen.findByRole("button", { name: "Überall abmelden" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Auf allen Geräten abmelden?",
    });
    expect(logoutEverywhere).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Überall abmelden" }));
    await waitFor(() => expect(logoutEverywhere).toHaveBeenCalledOnce());
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("stays signed in and shows an error when signing out everywhere fails", async () => {
    const user = userEvent.setup();
    logoutEverywhere.mockRejectedValue(new ApiError("boom", 500));
    renderProfile(true, "/profile/security");
    await user.click(await screen.findByRole("button", { name: "Überall abmelden" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Auf allen Geräten abmelden?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Überall abmelden" }));
    expect(await screen.findByText(/Abmelden auf allen Geräten hat nicht geklappt/)).toBeVisible();
    expect(logout).not.toHaveBeenCalled();
  });

  async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Konto löschen" }));
    return screen.findByRole("dialog", { name: "Konto löschen?" });
  }

  it("deletes the account after the confirmation, then signs out", async () => {
    const user = userEvent.setup();
    renderProfile(true, "/profile/privacy");
    const dialog = await openDeleteDialog(user);
    expect(within(dialog).queryByLabelText(/Passwort/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/me"));
    expect(logout).toHaveBeenCalled();
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("stays quiet and keeps the account when the step-up confirmation is cancelled", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 0, "step_up_cancelled"));
    const user = userEvent.setup();
    renderProfile(true, "/profile/privacy");
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it("tells about the rate limit", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    const user = userEvent.setup();
    renderProfile(true, "/profile/privacy");
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(await within(dialog).findByText(/Zu viele Versuche/)).toBeInTheDocument();
  });

  it("explains that the account stays while the user is the only member of a club", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 422, "last_member_of_club"));
    const user = userEvent.setup();
    renderProfile(true, "/profile/privacy");
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(await screen.findByText(/einzige Mitglied eines Vereins/)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it("shows an error with retry when the profile cannot be loaded", async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) =>
      path === "/api/auth/me"
        ? Promise.reject(new Error("API error 500"))
        : Promise.resolve(
            path === "/api/auth/mcp-grants" || path === "/api/clubs" ? [] : providers,
          ),
    );
    renderProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Profil konnte nicht geladen werden.",
    );
    // The settings below still work.
    expect(screen.getByRole("heading", { name: "Persönliche Einstellungen" })).toBeInTheDocument();
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/auth/me"
          ? profile
          : path === "/api/auth/mcp-grants" || path === "/api/clubs"
            ? []
            : providers,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("textbox", { name: /^Name/ })).toBeInTheDocument();
  });

  it("says so when there are no passkeys and no linked sign-ins", async () => {
    profile = { ...profile, passkeys: [], oauthAccounts: [] };
    providers = [];
    renderProfile(true, "/profile/security");
    expect(
      await screen.findByText("Du hast noch keine MFA-Methode eingerichtet."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Es ist keine Anmeldung über einen Anbieter/)).toBeInTheDocument();
  });
});

describe("ProfilePage (dialog while loading)", () => {
  it("keeps the delete dialog open when the profile data arrives", async () => {
    let resolveMe: (v: unknown) => void = () => {};
    apiGet.mockImplementation((path: string) =>
      path === "/api/auth/me"
        ? new Promise((r) => {
            resolveMe = r;
          })
        : Promise.resolve(
            path === "/api/auth/mcp-grants" || path === "/api/clubs" ? [] : providers,
          ),
    );
    const user = userEvent.setup();
    renderProfile(true, "/profile/privacy");
    await user.click(await screen.findByRole("button", { name: "Konto löschen" }));
    await screen.findByRole("dialog", { name: "Konto löschen?" });
    resolveMe(profile);
    // The loading state behind the modal dialog goes away once the data arrived.
    await waitFor(() =>
      expect(screen.queryByText("Profil wird geladen …")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "Konto löschen?" })).toBeInTheDocument();
  });
});
