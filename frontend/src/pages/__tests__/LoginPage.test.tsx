import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "../LoginPage";
import { ApiError } from "@/lib/api";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
const apiFetch = vi.fn();
const login = vi.fn();
const startAuthentication = vi.fn();

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
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
  await user.type(screen.getByLabelText(/^E-Mail/), "alex@beispiel.de");
  await user.type(screen.getByLabelText(/^Passwort \(Pflicht\)/), "geheim123");
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
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/^Passwort \(Pflicht\)/)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
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
    const input = screen.getByLabelText(/^Passwort \(Pflicht\)/);
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

  it("has no native validation bubble: empty fields get translated errors, summary takes focus", async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.getByRole("form", { name: "Anmeldeformular" })).toHaveAttribute("novalidate");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Die Anmeldung ist noch nicht vollständig");
    expect(alert).toHaveTextContent("Bitte gib deine E-Mail-Adresse ein.");
    expect(alert).toHaveTextContent("Bitte gib dein Passwort ein.");
    const email = screen.getByLabelText(/^E-Mail/);
    expect(alert).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Bitte gib deine E-Mail-Adresse ein.");
    expect(screen.getByLabelText(/^Passwort \(Pflicht\)/)).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();

    // The summary links to the fields.
    await user.click(screen.getByRole("link", { name: "Bitte gib dein Passwort ein." }));
    expect(screen.getByLabelText(/^Passwort \(Pflicht\)/)).toHaveFocus();
  });

  it("focuses the password when only that is missing and rejects a malformed email", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/^E-Mail/), "alex@beispiel.de");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(screen.getByLabelText(/^Passwort \(Pflicht\)/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^E-Mail/)).not.toHaveAttribute("aria-invalid");

    await user.clear(screen.getByLabelText(/^E-Mail/));
    await user.type(screen.getByLabelText(/^E-Mail/), "kein-at-zeichen");
    await user.type(screen.getByLabelText(/^Passwort \(Pflicht\)/), "geheim123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib eine gültige E-Mail-Adresse ein",
    );
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("marks required fields and validates on blur, clearing errors while editing", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = screen.getByLabelText("E-Mail (Pflicht)");
    expect(screen.getByLabelText("Passwort (Pflicht)")).toBeInTheDocument();
    await user.type(email, "kein-at");
    expect(email).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("gültige E-Mail-Adresse");

    await user.type(email, "@beispiel.de");
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/gültige E-Mail-Adresse/)).not.toBeInTheDocument();
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

  it("goes to the code page with the email of the 403 email_not_verified body", async () => {
    apiPost.mockRejectedValue(
      new ApiError("x", 403, "email_not_verified", undefined, { email: "alex@beispiel.de" }),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email?email=alex%40beispiel.de",
    );
    expect(login).not.toHaveBeenCalled();
  });

  it("falls back to the typed email when the 403 body has none", async () => {
    apiPost.mockRejectedValue(new ApiError("x", 403, "email_not_verified"));
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email?email=alex%40beispiel.de",
    );
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

  it("explains an untrusted provider without an address in the callback", () => {
    renderLogin("/login?error=email_verification_required");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wir müssen zuerst deine E-Mail-Adresse bestätigen",
    );
  });

  it("asks to confirm the address at the provider", () => {
    renderLogin("/login?error=email_unverified_at_provider");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deine E-Mail-Adresse ist beim Anbieter noch nicht bestätigt.",
    );
  });
});
