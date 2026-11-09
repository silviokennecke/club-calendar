import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { Toaster } from "@/components/ui/shared";
import i18n from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import ProfilePage from "../ProfilePage";

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

function renderProfile(inShell = true, path = "/profile") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <ProfilePage />
      <SearchProbe />
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
                <Route path="/profile" element={page} />
              </Route>
            ) : (
              <Route path="/profile" element={page} />
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
    if (path === "/api/auth/mcp-grants") return Promise.resolve([]);
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
    renderProfile();
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

    const keys = within(screen.getByRole("list", { name: "Deine Passkeys (2)" })).getAllByRole(
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
      renderProfile();
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
    renderProfile();
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

  it("keeps the last sign-in method: unlink disabled with an explanation", async () => {
    profile = { ...profile, hasPassword: false, passkeys: [] };
    renderProfile();
    const unlink = await screen.findByRole("button", { name: "Google-Verknüpfung trennen" });
    expect(unlink).toBeDisabled();
    expect(unlink).toHaveAccessibleDescription(/Mindestens eine Anmeldemethode muss bleiben/);
  });

  it("shows the result of the link flow once and removes it from the address", async () => {
    renderProfile(true, "/profile?linked=google");
    const sso = (await screen.findByRole("heading", { name: "Verknüpfte Anmeldungen" })).closest(
      "section",
    )!;
    expect(within(sso).getByRole("status")).toHaveTextContent("Google wurde verknüpft.");
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
  });

  it("completes a link flow with this session and removes the proof from the address", async () => {
    apiPost.mockResolvedValueOnce(undefined);
    renderProfile(true, "/profile?link_provider=google&link_proof=proof-value");
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
    renderProfile(true, "/profile?link_provider=google&link_proof=proof-value");
    expect(await screen.findByText("Das Konto wurde nicht verknüpft")).toBeInTheDocument();
    expect(screen.queryByText("Google wurde verknüpft.")).not.toBeInTheDocument();
  });

  it("explains a failed link by its code", async () => {
    renderProfile(true, "/profile?link_error=account_in_use");
    expect(await screen.findByText("Das Konto wurde nicht verknüpft")).toBeInTheDocument();
    expect(
      screen.getByText("Dieses Konto ist schon mit einem anderen Club-Calendar-Konto verknüpft."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
  });

  it("renames the account", async () => {
    const user = userEvent.setup();
    renderProfile();
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
    renderProfile();
    const panel = (await screen.findByRole("heading", { level: 2, name: "Passwort" })).closest(
      "section",
    )!;
    await user.type(within(panel).getByLabelText(/^Aktuelles Passwort/), "old-password");
    await user.type(within(panel).getByLabelText(/^Neues Passwort/), "short");
    await user.click(within(panel).getByRole("button", { name: "Passwort ändern" }));
    expect(await within(panel).findByText(/Das Passwort ist zu kurz/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();

    await user.type(within(panel).getByLabelText(/^Neues Passwort/), "-and-longer");
    await user.type(within(panel).getByLabelText(/^Passwort wiederholen/), "short-and-longer");
    await user.click(within(panel).getByRole("button", { name: "Passwort ändern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/change-password", {
        currentPassword: "old-password",
        newPassword: "short-and-longer",
      }),
    );
    expect(login).toHaveBeenCalledWith("a2", "r2", { id: "u1" });
    expect(await screen.findByText(/Passwort geändert/)).toBeInTheDocument();
  });

  it("names a wrong current password at its field", async () => {
    apiPost.mockRejectedValue(new ApiError("x", 400, "invalid_credentials"));
    const user = userEvent.setup();
    renderProfile();
    const panel = (await screen.findByRole("heading", { level: 2, name: "Passwort" })).closest(
      "section",
    )!;
    await user.type(within(panel).getByLabelText(/^Aktuelles Passwort/), "wrong");
    await user.type(within(panel).getByLabelText(/^Neues Passwort/), "new-password-1");
    await user.type(within(panel).getByLabelText(/^Passwort wiederholen/), "new-password-1");
    await user.click(within(panel).getByRole("button", { name: "Passwort ändern" }));
    expect(await within(panel).findByText("Das Passwort stimmt nicht.")).toBeInTheDocument();
    // The error is not a live region: focus moves to the field so that it is announced.
    await waitFor(() => expect(within(panel).getByLabelText(/^Aktuelles Passwort/)).toHaveFocus());
    expect(login).not.toHaveBeenCalled();
  });

  it("lets SSO-only accounts set a password by e-mail and explains why the address is fixed", async () => {
    profile = { ...profile, hasPassword: false };
    const user = userEvent.setup();
    renderProfile();
    expect(await screen.findByText(/lege zuerst ein Passwort fest/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Neue E-Mail-Adresse/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Passwort per E-Mail festlegen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/forgot-password", {
        email: "alex@beispiel.de",
      }),
    );
    expect(await screen.findByText("Prüfe dein Postfach")).toBeInTheDocument();
  });

  it("requests a new e-mail address with the password and shows the pending change", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.type(await screen.findByLabelText(/^Neue E-Mail-Adresse/), "neu@beispiel.de");
    const account = screen
      .getByRole("heading", { name: "Name und E-Mail-Adresse" })
      .closest("section")!;
    await user.type(within(account).getByLabelText(/^Aktuelles Passwort/), "password123");
    profile = { ...profile, pendingEmail: "neu@beispiel.de" };
    await user.click(screen.getByRole("button", { name: "Bestätigungslink senden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/change-email", {
        email: "neu@beispiel.de",
        password: "password123",
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
    renderProfile(false);
    expect(await screen.findByRole("heading", { level: 1, name: "Profil" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu allen Vereinen" })).toHaveAttribute(
      "href",
      "/clubs?select=1",
    );
    expect(await screen.findByRole("heading", { name: "Passkeys" })).toBeInTheDocument();
  });

  it("signs out", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
  });

  it("saves the date format, first weekday and language on the account", async () => {
    const user = userEvent.setup();
    renderProfile();
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
    renderProfile();
    await user.click(await screen.findByRole("radio", { name: "2026-12-31" }));
    expect(
      await screen.findByText(
        "Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
  });

  it("switches the theme and remembers it in this browser", async () => {
    const user = userEvent.setup();
    renderProfile();
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

  it("removes a passkey only after confirming and names the consequence", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(
      await screen.findByRole("button", { name: "Passkey „iPhone Alex“ entfernen" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Passkey „iPhone Alex“ entfernen?",
    });
    expect(dialog).toHaveTextContent("Deine anderen Anmeldewege bleiben bestehen.");
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Passkey entfernen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/webauthn/p2"));
  });

  it("signs out everywhere only after confirming, then signs out locally", async () => {
    const user = userEvent.setup();
    logoutEverywhere.mockResolvedValue(undefined);
    renderProfile();
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
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Überall abmelden" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Auf allen Geräten abmelden?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Überall abmelden" }));
    expect(await screen.findByText(/Abmelden auf allen Geräten hat nicht geklappt/)).toBeVisible();
    expect(logout).not.toHaveBeenCalled();
  });

  it("continues with the fresh tokens after a passkey was removed", async () => {
    const user = userEvent.setup();
    apiDelete.mockResolvedValue({
      ok: true,
      access_token: "a2",
      refresh_token: "r2",
      user: authUser,
    });
    renderProfile();
    await user.click(
      await screen.findByRole("button", { name: "Passkey „iPhone Alex“ entfernen" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Passkey entfernen" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a2", "r2", authUser));
  });

  it("sets up a passkey after the password was confirmed and refreshes the list", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ options: { challenge: "x" }, challengeToken: "t" });
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    startRegistration.mockResolvedValue({ id: "cred" });
    renderProfile();
    await user.type(await screen.findByLabelText(/^Gerätename/), "Büro-PC");
    await user.click(screen.getByRole("button", { name: "Passkey auf diesem Gerät einrichten" }));
    const dialog = await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" });
    await user.type(within(dialog).getByLabelText(/Dein Passwort/), "geheim123");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(await screen.findByText("Passkey „Büro-PC“ wurde hinzugefügt.")).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith("/api/auth/webauthn/register/options", {
      password: "geheim123",
    });
    const verify = apiFetch.mock.calls.find(([p]) => String(p).endsWith("/register/verify"))!;
    expect(JSON.parse(verify[1].body)).toEqual({
      challengeToken: "t",
      response: { id: "cred" },
      deviceName: "Büro-PC",
    });
    expect(apiGet.mock.calls.filter(([p]) => p === "/api/auth/me").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("starts nothing when the password is wrong", async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(new ApiError("x", 400, "invalid_credentials"));
    renderProfile();
    await user.click(
      await screen.findByRole("button", { name: "Passkey auf diesem Gerät einrichten" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" });
    await user.type(within(dialog).getByLabelText(/Dein Passwort/), "falsch");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(
      await within(dialog).findByText(/Passwort ist nicht korrekt|Passwort stimmt nicht/),
    ).toBeInTheDocument();
    expect(startRegistration).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("confirms an account without a password with the mailed code before the passkey", async () => {
    profile = { ...profile, hasPassword: false };
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ options: { challenge: "x" }, challengeToken: "t" });
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    startRegistration.mockResolvedValue({ id: "cred" });
    renderProfile();
    await user.click(
      await screen.findByRole("button", { name: "Passkey auf diesem Gerät einrichten" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" });
    await user.click(within(dialog).getByRole("button", { name: "Code senden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/webauthn/register/code", {}),
    );
    // An incomplete code is not sent
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(apiPost).not.toHaveBeenCalledWith(
      "/api/auth/webauthn/register/options",
      expect.anything(),
    );
    await user.click(within(dialog).getAllByRole("textbox")[0]);
    await user.paste("123456");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/webauthn/register/options", {
        code: "123456",
      }),
    );
    expect(await screen.findByText(/wurde hinzugefügt/)).toBeInTheDocument();
  });

  it("shows a wrong passkey code at the field", async () => {
    profile = { ...profile, hasPassword: false };
    apiPost.mockRejectedValue(new ApiError("x", 400, "invalid_confirmation_code"));
    const user = userEvent.setup();
    renderProfile();
    await user.click(
      await screen.findByRole("button", { name: "Passkey auf diesem Gerät einrichten" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" });
    await user.click(within(dialog).getAllByRole("textbox")[0]);
    await user.paste("123456");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(
      await within(dialog).findByText("Der Code ist nicht korrekt oder abgelaufen."),
    ).toBeInTheDocument();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("explains a failed passkey setup and a cancelled one differently", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ options: { challenge: "x" }, challengeToken: "t" });
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const confirm = async () => {
      await user.click(add);
      const dialog = await screen.findByRole("dialog", { name: "Bestätige, dass du es bist" });
      await user.type(within(dialog).getByLabelText(/Dein Passwort/), "geheim123");
      await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    };
    renderProfile();
    const add = await screen.findByRole("button", { name: "Passkey auf diesem Gerät einrichten" });
    startRegistration.mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await confirm();
    expect(await screen.findByText(/Das Einrichten wurde abgebrochen/)).toBeInTheDocument();
    startRegistration.mockRejectedValue(new Error("boom"));
    await confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Passkey konnte nicht eingerichtet werden.",
    );
    expect(screen.queryByText(/abgebrochen/)).not.toBeInTheDocument();
  });

  it("disables the passkey setup in browsers without passkey support", async () => {
    Reflect.deleteProperty(window, "PublicKeyCredential");
    renderProfile();
    expect(
      await screen.findByText("Dieser Browser unterstützt keine Passkeys."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Passkey auf diesem Gerät einrichten" }),
    ).toBeDisabled();
  });

  async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Konto löschen" }));
    return screen.findByRole("dialog", { name: "Konto löschen?" });
  }

  it("deletes the account only with the password, then signs out", async () => {
    const user = userEvent.setup();
    renderProfile();
    const dialog = await openDeleteDialog(user);
    // Without a password nothing is sent
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(apiDelete).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Bitte gib dein aktuelles Passwort ein.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Zur Bestätigung dein Passwort/), "geheim123");
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith("/api/auth/me", { password: "geheim123" }),
    );
    expect(logout).toHaveBeenCalled();
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("shows a wrong password at the field and keeps the account", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 400, "invalid_credentials"));
    const user = userEvent.setup();
    renderProfile();
    const dialog = await openDeleteDialog(user);
    await user.type(within(dialog).getByLabelText(/Zur Bestätigung dein Passwort/), "falsch");
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(await within(dialog).findByText("Das Passwort stimmt nicht.")).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it("tells about the rate limit", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    const user = userEvent.setup();
    renderProfile();
    const dialog = await openDeleteDialog(user);
    await user.type(within(dialog).getByLabelText(/Zur Bestätigung dein Passwort/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(await within(dialog).findByText(/Zu viele Versuche/)).toBeInTheDocument();
  });

  it("confirms an account without a password with the mailed code", async () => {
    profile = { ...profile, hasPassword: false };
    const user = userEvent.setup();
    renderProfile();
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Code senden" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/auth/delete-account/code", {}));
    expect(
      await within(dialog).findByText(/Der Code wurde an alex@beispiel.de/),
    ).toBeInTheDocument();
    // An incomplete code is not sent
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getAllByRole("textbox")[0]);
    await user.paste("123456");
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/me", { code: "123456" }));
    expect(logout).toHaveBeenCalled();
  });

  it("shows a wrong code at the field", async () => {
    profile = { ...profile, hasPassword: false };
    apiDelete.mockRejectedValue(new ApiError("x", 400, "invalid_confirmation_code"));
    const user = userEvent.setup();
    renderProfile();
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getAllByRole("textbox")[0]);
    await user.paste("123456");
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(
      await within(dialog).findByText("Der Code stimmt nicht oder ist abgelaufen."),
    ).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it("explains that the account stays while the user is the only member of a club", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 422, "last_member_of_club"));
    const user = userEvent.setup();
    renderProfile();
    const dialog = await openDeleteDialog(user);
    await user.type(within(dialog).getByLabelText(/Zur Bestätigung dein Passwort/), "geheim123");
    await user.click(within(dialog).getByRole("button", { name: "Konto löschen" }));
    expect(await screen.findByText(/einzige Mitglied eines Vereins/)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it("shows an error with retry when the profile cannot be loaded", async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) =>
      path === "/api/auth/me"
        ? Promise.reject(new Error("API error 500"))
        : Promise.resolve(path === "/api/auth/mcp-grants" ? [] : providers),
    );
    renderProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Profil konnte nicht geladen werden.",
    );
    // The settings below still work.
    expect(screen.getByRole("heading", { name: "Persönliche Einstellungen" })).toBeInTheDocument();
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/auth/me" ? profile : path === "/api/auth/mcp-grants" ? [] : providers,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("heading", { name: "Passkeys" })).toBeInTheDocument();
  });

  it("says so when there are no passkeys and no linked sign-ins", async () => {
    profile = { ...profile, passkeys: [], oauthAccounts: [] };
    providers = [];
    renderProfile();
    expect(
      await screen.findByText("Du hast noch keinen Passkey eingerichtet."),
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
        : Promise.resolve(path === "/api/auth/mcp-grants" ? [] : providers),
    );
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Konto löschen" }));
    await screen.findByRole("dialog", { name: "Konto löschen?" });
    resolveMe(profile);
    // The page behind the modal dialog is inert, hence `hidden`.
    await screen.findByRole("heading", { name: "Passkeys", hidden: true });
    expect(screen.getByRole("dialog", { name: "Konto löschen?" })).toBeInTheDocument();
  });
});
