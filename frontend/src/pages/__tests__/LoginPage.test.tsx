import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "../LoginPage";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
const apiFetch = vi.fn();
const login = vi.fn();
const startAuthentication = vi.fn();

vi.mock("@/lib/api", () => ({
  BACKEND_URL: "http://api.test",
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login }) }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
}));

const providers = [
  { id: "google", name: "Google", icon: "google" },
  { id: "microsoft", name: "Microsoft", icon: "microsoft" },
];

function renderLogin(path = "/login") {
  return renderAt(path, "/login", <LoginPage />);
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-Mail"), "alex@beispiel.de");
  await user.type(screen.getByLabelText("Passwort"), "geheim123");
  await user.click(screen.getByRole("button", { name: "Anmelden" }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve(providers) }));
});

describe("LoginPage", () => {
  it("renders the form, SSO buttons from the providers endpoint and the auth frame", async () => {
    renderLogin();
    expect(screen.getByRole("heading", { level: 1, name: "Anmelden" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zum Inhalt springen" })).toHaveAttribute(
      "href",
      "#main",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByLabelText("E-Mail")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Passwort")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("link", { name: "Passwort vergessen?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByRole("button", { name: "Mit Passkey anmelden" })).toBeInTheDocument();
    const google = await screen.findByRole("link", { name: "Mit Google anmelden" });
    expect(google).toHaveAttribute("href", "http://api.test/api/auth/oauth/google");
    expect(screen.getByRole("link", { name: "Mit Microsoft anmelden" })).toBeInTheDocument();
  });

  it("toggles password visibility with aria-pressed", async () => {
    const user = userEvent.setup();
    renderLogin();
    const input = screen.getByLabelText("Passwort");
    const toggle = screen.getByRole("button", { name: "Passwort anzeigen" });
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "password");
  });

  it("signs in and navigates to /clubs", async () => {
    apiPost.mockResolvedValue({ access_token: "a", refresh_token: "r", user: { id: "u1" } });
    renderLogin();
    await fillAndSubmit();
    await waitFor(() => expect(login).toHaveBeenCalledWith("a", "r", { id: "u1" }));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/login", {
      email: "alex@beispiel.de",
      password: "geheim123",
    });
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
  });

  it("has no native validation bubble: empty fields get translated errors, focus on the first one", async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.getByRole("form", { name: "Anmeldeformular" })).toHaveAttribute("novalidate");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Die Anmeldung ist noch nicht vollständig");
    expect(alert).toHaveTextContent("Bitte gib deine E-Mail-Adresse ein.");
    expect(alert).toHaveTextContent("Bitte gib dein Passwort ein.");
    const email = screen.getByLabelText("E-Mail");
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Bitte gib deine E-Mail-Adresse ein.");
    expect(screen.getByLabelText("Passwort")).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();

    // The summary links to the fields.
    await user.click(screen.getByRole("link", { name: "Bitte gib dein Passwort ein." }));
    expect(screen.getByLabelText("Passwort")).toHaveFocus();
  });

  it("focuses the password when only that is missing and rejects a malformed email", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("E-Mail"), "alex@beispiel.de");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(screen.getByLabelText("Passwort")).toHaveFocus();
    expect(screen.getByLabelText("E-Mail")).not.toHaveAttribute("aria-invalid");

    await user.clear(screen.getByLabelText("E-Mail"));
    await user.type(screen.getByLabelText("E-Mail"), "kein-at-zeichen");
    await user.type(screen.getByLabelText("Passwort"), "geheim123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib eine gültige E-Mail-Adresse ein",
    );
    expect(screen.getByLabelText("E-Mail")).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows a focused alert banner with a reset link for wrong credentials", async () => {
    apiPost.mockRejectedValue(Object.assign(new Error("Invalid credentials"), { status: 401 }));
    renderLogin();
    await fillAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("E-Mail oder Passwort stimmt nicht");
    expect(screen.getByRole("link", { name: "Passwort zurücksetzen" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(alert.parentElement).toHaveFocus();
    expect(login).not.toHaveBeenCalled();
  });

  it("offers to resend the confirmation mail when the email is unverified", async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("email_not_verified"), { status: 403, code: "email_not_verified" }),
    );
    apiFetch.mockResolvedValue({ ok: true });
    renderLogin();
    const user = await fillAndSubmit();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("E-Mail-Adresse noch nicht bestätigt");

    await user.click(screen.getByRole("button", { name: "Bestätigungsmail erneut senden" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email: "alex@beispiel.de" }),
    });
    expect(await screen.findByText("Bestätigungsmail gesendet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bestätigungsmail erneut senden" })).toBeNull();
  });

  it("shows the passkey error banner when passkey sign-in fails", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({
      json: () => Promise.resolve({ options: {}, challengeToken: "c" }),
    });
    startAuthentication.mockRejectedValue(new Error("boom"));
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Anmeldung mit Passkey nicht möglich",
    );
  });

  it("stays silent when the passkey dialog is cancelled", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({
      json: () => Promise.resolve({ options: {}, challengeToken: "c" }),
    });
    startAuthentication.mockRejectedValue(new Error("The operation was cancelled"));
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    await waitFor(() => expect(startAuthentication).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the SSO error banner when redirected back with ?error", () => {
    renderLogin("/login?error=oauth_failed");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Anmeldung mit Google oder Microsoft nicht möglich");
    expect(alert).toHaveTextContent("Die Anmeldung über den Anbieter hat nicht geklappt.");
  });

  it("explains the finer SSO error codes in their own words", () => {
    renderLogin("/login?error=provider_denied");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Du hast die Anmeldung beim Anbieter abgebrochen.",
    );
  });

  it("asks to confirm the address at the provider", () => {
    renderLogin("/login?error=email_unverified_at_provider");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deine E-Mail-Adresse ist beim Anbieter noch nicht bestätigt.",
    );
  });
});
