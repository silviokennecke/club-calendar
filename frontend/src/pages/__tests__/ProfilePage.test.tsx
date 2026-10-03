import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { Toaster } from "@/components/ui/shared";
import i18n from "@/lib/i18n";
import ProfilePage from "../ProfilePage";

const apiGet = vi.fn();
const apiDelete = vi.fn();
const apiFetch = vi.fn();
const updateUser = vi.fn();
const logout = vi.fn();
const startRegistration = vi.fn();
let authUser: Record<string, unknown>;

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: authUser, updateUser, logout }),
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
function ShellStub() {
  return <Outlet context={{}} />;
}

function renderProfile(inShell = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = <ProfilePage />;
  return render(
    <ThemeProvider>
      <Toaster />
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/profile"]}>
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
    passkeys: [
      { id: "p1", deviceName: "MacBook Alex", createdAt: "2026-03-12T09:00:00+00:00" },
      { id: "p2", deviceName: "iPhone Alex", createdAt: "2026-09-08T09:00:00+00:00" },
    ],
    oauthAccounts: [{ provider: "google" }],
  };
  providers = [
    { id: "google", name: "Google", icon: "google" },
    { id: "microsoft", name: "Microsoft", icon: "microsoft" },
  ];
  for (const fn of [apiGet, apiDelete, apiFetch, updateUser, logout, startRegistration])
    fn.mockReset();
  updateUser.mockResolvedValue(true);
  apiDelete.mockResolvedValue(undefined);
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/auth/me") return Promise.resolve(profile);
    if (path === "/api/auth/providers") return Promise.resolve(providers);
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
    expect(
      screen.getByText("Name und E-Mail können hier noch nicht geändert werden."),
    ).toBeInTheDocument();

    const sso = (await screen.findByRole("heading", { name: "Verknüpfte Anmeldungen" })).closest(
      "section",
    )!;
    await within(sso).findByText("Microsoft");
    const rows = within(sso).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Google");
    expect(rows[0]).toHaveTextContent("Verbunden");
    expect(rows[1]).toHaveTextContent("Microsoft");
    expect(rows[1]).toHaveTextContent("Nicht verbunden");
    // Linking and unlinking is not possible yet: disabled and explained.
    for (const b of within(sso).getAllByRole("button")) {
      expect(b).toBeDisabled();
      expect(b).toHaveAccessibleDescription(/Bald verfügbar/);
    }

    const keys = within(screen.getByRole("list", { name: "Deine Passkeys (2)" })).getAllByRole(
      "listitem",
    );
    expect(keys[0]).toHaveTextContent("MacBook Alex");
    expect(keys[0]).toHaveTextContent("hinzugefügt am 12.03.2026");
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

  it("sets up a passkey with the device name and refreshes the list", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path: string) =>
      path.endsWith("/register/options")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ options: { challenge: "x" }, challengeToken: "t" }),
          })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
    );
    startRegistration.mockResolvedValue({ id: "cred" });
    renderProfile();
    await user.type(await screen.findByLabelText(/^Gerätename/), "Büro-PC");
    await user.click(screen.getByRole("button", { name: "Passkey auf diesem Gerät einrichten" }));
    expect(await screen.findByText("Passkey „Büro-PC“ wurde hinzugefügt.")).toBeInTheDocument();
    const verify = apiFetch.mock.calls.find(([p]) => String(p).endsWith("/register/verify"))!;
    expect(JSON.parse(verify[1].body)).toEqual({
      challengeToken: "t",
      response: { id: "cred" },
      deviceName: "Büro-PC",
    });
    // The list was reloaded.
    expect(apiGet.mock.calls.filter(([p]) => p === "/api/auth/me").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("explains a failed passkey setup and a cancelled one differently", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ options: { challenge: "x" }, challengeToken: "t" }),
    });
    renderProfile();
    const add = await screen.findByRole("button", { name: "Passkey auf diesem Gerät einrichten" });
    startRegistration.mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await user.click(add);
    expect(await screen.findByText(/Das Einrichten wurde abgebrochen/)).toBeInTheDocument();
    startRegistration.mockRejectedValue(new Error("boom"));
    await user.click(add);
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

  it("deletes the account only after typing the e-mail address, then signs out", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Konto löschen" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Konto löschen?" });
    const confirm = within(dialog).getByRole("button", { name: "Konto löschen" });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Zur Bestätigung deine E-Mail-Adresse eingeben"),
      "alex@beispiel.de",
    );
    await user.click(confirm);
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/me"));
    expect(logout).toHaveBeenCalled();
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("shows an error with retry when the profile cannot be loaded", async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) =>
      path === "/api/auth/me"
        ? Promise.reject(new Error("API error 500"))
        : Promise.resolve(providers),
    );
    renderProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Profil konnte nicht geladen werden.",
    );
    // The settings below still work.
    expect(screen.getByRole("heading", { name: "Persönliche Einstellungen" })).toBeInTheDocument();
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/auth/me" ? profile : providers),
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
        : Promise.resolve(providers),
    );
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("button", { name: "Konto löschen" }));
    await screen.findByRole("alertdialog", { name: "Konto löschen?" });
    resolveMe(profile);
    // The page behind the modal dialog is inert, hence `hidden`.
    await screen.findByRole("heading", { name: "Passkeys", hidden: true });
    expect(screen.getByRole("alertdialog", { name: "Konto löschen?" })).toBeInTheDocument();
  });
});
