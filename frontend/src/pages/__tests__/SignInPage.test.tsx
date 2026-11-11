import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SignInPage from "../SignInPage";
import { ApiError } from "@/lib/api";
import { clearFeedProof, stashFeedProof } from "@/lib/feeds/feedProof";
import { clearInvitationToken, stashInvitationToken } from "@/lib/invitations";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
const apiGet = vi.fn();
const apiFetch = vi.fn();
const login = vi.fn();
const startAuthentication = vi.fn();
const cancelCeremony = vi.fn();

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  BACKEND_URL: "http://api.test",
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login }) }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
  WebAuthnAbortService: { cancelCeremony: () => cancelCeremony() },
}));

function HistoryButtons() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate(-1)}>history-back</button>
      <button onClick={() => navigate(1)}>history-forward</button>
    </>
  );
}

const providers = [
  { id: "google", name: "Google", icon: "google" },
  { id: "microsoft", name: "Microsoft", icon: "microsoft" },
];
const NONE = { imprint: null, privacy: null, terms: null };

type Status = "login" | "register" | "registration_restricted";

/** Routes the mocked API: identify answers `status`, everything else is configured per test. */
function mockApi(status: Status = "login", extra: Record<string, unknown> = {}) {
  apiGet.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/auth/registration" ? { restricted: false } : NONE),
  );
  apiPost.mockImplementation((path: string, body: { email?: string }) => {
    if (path === "/api/auth/identify") {
      return Promise.resolve({ email: (body.email ?? "").toLowerCase(), status });
    }
    if (path in extra) return Promise.resolve(extra[path]);
    return Promise.resolve({});
  });
}

function renderFlow(path = "/login") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderAt(
    path,
    path.split("?")[0],
    <QueryClientProvider client={qc}>
      <SignInPage />
    </QueryClientProvider>,
  );
}

/** Step 1: type the address and press Continue. */
async function continueWith(address = "Alex@beispiel.de") {
  const user = userEvent.setup();
  const field = screen.getByLabelText(/^E-Mail/);
  if (address) await user.type(field, address);
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  return user;
}

async function loginStep() {
  mockApi("login");
  renderFlow();
  const user = await continueWith();
  await screen.findByLabelText(/^Passwort$/);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearInvitationToken();
  clearFeedProof();
  mockApi();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve(providers) }));
});

describe("step 1: email", () => {
  it("shows only the email field plus SSO and passkey buttons in the auth frame", async () => {
    renderFlow();
    expect(
      screen.getByRole("heading", { level: 1, name: "Anmelden oder Konto erstellen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    const email = screen.getByLabelText(/^E-Mail/);
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(screen.queryByLabelText(/^Passwort/)).toBeNull();
    expect(screen.getByRole("button", { name: "Mit Passkey anmelden" })).toBeInTheDocument();
    const google = await screen.findByRole("link", { name: "Mit Google anmelden" });
    expect(google).toHaveAttribute("href", "http://api.test/api/auth/oauth/google");
    expect(screen.getByRole("link", { name: "Mit Microsoft anmelden" })).toBeInTheDocument();
  });

  it("starts SSO with a code challenge and keeps the verifier in this tab", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    sessionStorage.clear();
    renderFlow();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Mit Google anmelden" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("http://api.test/api/auth/oauth/google");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionStorage.getItem("sso_code_verifier")).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("validates on submit, not while typing", async () => {
    renderFlow();
    const user = userEvent.setup();
    const email = screen.getByLabelText(/^E-Mail/);
    await user.type(email, "kein-at");
    await user.tab();
    expect(email).not.toHaveAttribute("aria-invalid");

    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gültige E-Mail-Adresse");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();

    await user.type(email, "@beispiel.de");
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("asks for an address when the field is empty", async () => {
    renderFlow();
    await continueWith("");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib deine E-Mail-Adresse ein.",
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows the SSO error banner when redirected back with ?error", () => {
    renderFlow("/login?error=provider_denied");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Du hast die Anmeldung beim Anbieter abgebrochen.",
    );
  });

  it("shows the passkey error banner when passkey sign-in fails", async () => {
    const user = userEvent.setup();
    renderFlow();
    apiFetch.mockResolvedValue({
      json: () => Promise.resolve({ options: {}, challengeToken: "c" }),
    });
    startAuthentication.mockRejectedValue(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Anmeldung mit Passkey nicht möglich",
    );
  });

  it("stays silent when the passkey dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderFlow();
    apiFetch.mockResolvedValue({
      json: () => Promise.resolve({ options: {}, challengeToken: "c" }),
    });
    startAuthentication.mockRejectedValue(new Error("The operation was cancelled"));
    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    await waitFor(() => expect(startAuthentication).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("passkey autofill", () => {
    afterEach(() => {
      vi.stubGlobal("PublicKeyCredential", undefined);
    });

    it("does nothing when conditional mediation is unavailable", async () => {
      vi.stubGlobal("PublicKeyCredential", {
        isConditionalMediationAvailable: () => Promise.resolve(false),
      });
      renderFlow();
      await screen.findByLabelText(/^E-Mail/);
      await new Promise((r) => setTimeout(r, 20));
      expect(startAuthentication).not.toHaveBeenCalled();
    });

    it("starts the conditional ceremony, signs in and stays silent on abort", async () => {
      vi.stubGlobal("PublicKeyCredential", {
        isConditionalMediationAvailable: () => Promise.resolve(true),
      });
      apiFetch.mockImplementation((path: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              path.includes("options")
                ? { options: {}, challengeToken: "c" }
                : { access_token: "a", refresh_token: "r", user: { id: "1" } },
            ),
        }),
      );
      startAuthentication.mockResolvedValue({ id: "x" });
      renderFlow();
      await waitFor(() => expect(login).toHaveBeenCalled());
      expect(startAuthentication).toHaveBeenCalledWith(
        expect.objectContaining({ useBrowserAutofill: true }),
      );
    });

    it.each(["NotSupportedError", "SecurityError", "Error"])(
      "shows no banner when the autofill attempt fails with %s",
      async (name) => {
        vi.stubGlobal("PublicKeyCredential", {
          isConditionalMediationAvailable: () => Promise.resolve(true),
        });
        apiFetch.mockResolvedValue({
          json: () => Promise.resolve({ options: {}, challengeToken: "c" }),
        });
        const err = new Error("no authenticator");
        err.name = name;
        startAuthentication.mockRejectedValue(err);
        renderFlow();
        await waitFor(() => expect(startAuthentication).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByRole("alert")).toBeNull();
      },
    );

    it("shows no banner when fetching the autofill options fails", async () => {
      vi.stubGlobal("PublicKeyCredential", {
        isConditionalMediationAvailable: () => Promise.resolve(true),
      });
      apiFetch.mockRejectedValue(new Error("offline"));
      renderFlow();
      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows the banner when the server rejects the autofilled assertion", async () => {
      vi.stubGlobal("PublicKeyCredential", {
        isConditionalMediationAvailable: () => Promise.resolve(true),
      });
      apiFetch.mockImplementation((path: string) =>
        Promise.resolve(
          path.includes("options")
            ? { ok: true, json: () => Promise.resolve({ options: {}, challengeToken: "c" }) }
            : { ok: false, json: () => Promise.resolve({ code: "invalid_passkey" }) },
        ),
      );
      startAuthentication.mockResolvedValue({ id: "x" });
      renderFlow();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Anmeldung mit Passkey nicht möglich",
      );
      expect(login).not.toHaveBeenCalled();
    });

    it("ignores AbortError and cancels the ceremony on submit", async () => {
      vi.stubGlobal("PublicKeyCredential", {
        isConditionalMediationAvailable: () => Promise.resolve(true),
      });
      apiFetch.mockResolvedValue({
        json: () => Promise.resolve({ options: {}, challengeToken: "c" }),
      });
      const abort = new Error("aborted");
      abort.name = "AbortError";
      startAuthentication.mockRejectedValue(abort);
      renderFlow();
      await waitFor(() => expect(startAuthentication).toHaveBeenCalled());
      expect(screen.queryByRole("alert")).toBeNull();
      cancelCeremony.mockClear();
      await continueWith();
      await waitFor(() => expect(cancelCeremony).toHaveBeenCalled());
    });
  });

  it("shows the wait time of a rate-limited identify (429 Retry-After)", async () => {
    apiPost.mockRejectedValue(
      new ApiError("x", 429, "rate_limited", undefined, { retryAfter: 600 }),
    );
    renderFlow();
    await continueWith();
    expect(await screen.findByRole("alert")).toHaveTextContent("in etwa 10 Min.");
    expect(screen.queryByLabelText(/^Passwort/)).toBeNull();
  });

  it("shows a general error when identify fails", async () => {
    apiPost.mockRejectedValue(new Error("offline"));
    renderFlow();
    await continueWith();
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geprüft werden");
  });
});

describe("identify: login", () => {
  it("opens the password step, fixes the address, drops SSO and passkey and focuses the password", async () => {
    await loginStep();
    expect(apiPost).toHaveBeenCalledWith("/api/auth/identify", { email: "Alex@beispiel.de" });
    expect(screen.getByRole("heading", { level: 1, name: "Anmelden" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Passwort$/)).toHaveFocus();
    expect(screen.getByLabelText(/^Passwort$/)).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("E-Mail", { selector: "#login-email" })).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText("E-Mail", { selector: "#login-email" })).toHaveValue(
      "alex@beispiel.de",
    );
    const hidden = document.querySelector<HTMLInputElement>('input[name="username"]')!;
    expect(hidden).toHaveValue("alex@beispiel.de");
    expect(hidden).toHaveAttribute("autocomplete", "username");
    expect(hidden).toHaveAttribute("aria-hidden", "true");
    expect(hidden).toHaveAttribute("tabindex", "-1");
    expect(hidden.hidden).toBe(false);
    expect(hidden.form).toBe(screen.getByLabelText(/^Passwort$/).closest("form"));
    expect(screen.getByLabelText(/^Passwort$/)).toHaveAttribute("name", "password");
    expect(screen.getByRole("button", { name: "Anmelden" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Passwort vergessen?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByText(/Google, Microsoft oder einem Passkey/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gib dein Passwort ein");
    // step 1 is hidden at once and removed after the exit transition
    expect(screen.queryByRole("button", { name: "Mit Passkey anmelden" })).toBeNull();
    await waitFor(() => expect(screen.queryByText("Mit Google anmelden")).toBeNull());
  });

  it("signs in and navigates to /clubs", async () => {
    const user = await loginStep();
    apiPost.mockResolvedValue({ access_token: "a", refresh_token: "r", user: { id: "u1" } });
    await user.type(screen.getByLabelText(/^Passwort$/), "geheim123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a", "r", { id: "u1" }));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/login", {
      email: "alex@beispiel.de",
      password: "geheim123",
    });
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
  });

  it("requires a password without calling the API", async () => {
    const user = await loginStep();
    apiPost.mockClear();
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bitte gib dein Passwort ein.");
    expect(screen.getByLabelText(/^Passwort$/)).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("toggles password visibility with aria-pressed", async () => {
    const user = await loginStep();
    const input = screen.getByLabelText(/^Passwort$/);
    const toggle = screen.getByRole("button", { name: "Passwort anzeigen" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
  });

  it("shows a focused alert banner with a reset link for wrong credentials", async () => {
    const user = await loginStep();
    apiPost.mockRejectedValue(Object.assign(new Error("Invalid"), { status: 401 }));
    await user.type(screen.getByLabelText(/^Passwort$/), "falsch");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("E-Mail oder Passwort stimmt nicht");
    expect(screen.getByRole("link", { name: "Passwort zurücksetzen" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(alert.parentElement).toHaveFocus();
    expect(login).not.toHaveBeenCalled();
  });

  it("explains a rate-limited login with the Retry-After wait", async () => {
    const user = await loginStep();
    apiPost.mockRejectedValue(
      new ApiError("x", 429, "rate_limited", undefined, { retryAfter: 90 }),
    );
    await user.type(screen.getByLabelText(/^Passwort$/), "geheim123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Zu viele Versuche");
    expect(alert).toHaveTextContent("in etwa 2 Min.");
    expect(alert).not.toHaveTextContent("stimmt nicht");
  });

  it("stores the restricted session and goes to the code page when the address is unconfirmed", async () => {
    const user = await loginStep();
    apiPost.mockResolvedValue({
      access_token: "a",
      refresh_token: "r",
      user: { id: "u1" },
      emailVerificationRequired: true,
    });
    await user.type(screen.getByLabelText(/^Passwort$/), "geheim123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("a", "r", { id: "u1", emailVerificationRequired: true }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/verify-email");
  });

  it("goes back with the Back button: address kept, SSO and passkey return, email focused", async () => {
    const user = await loginStep();
    await user.click(screen.getByRole("button", { name: "Zurück" }));
    const email = await screen.findByLabelText(/^E-Mail/);
    expect(email).toHaveValue("alex@beispiel.de");
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByRole("button", { name: "Mit Passkey anmelden" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Anmelden oder Konto erstellen",
    );
  });

  it("browser Back returns to step 1 (address kept), Forward shows step 2 again", async () => {
    mockApi("login");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <HistoryButtons />
        <Routes>
          <Route
            path="/login"
            element={
              <QueryClientProvider client={qc}>
                <SignInPage />
              </QueryClientProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const user = await continueWith();
    await screen.findByLabelText(/^Passwort$/);
    await user.click(screen.getByRole("button", { name: "history-back" }));
    expect(await screen.findByRole("button", { name: "Weiter" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^E-Mail/ })).toHaveValue("alex@beispiel.de");
    await user.click(screen.getByRole("button", { name: "history-forward" }));
    await screen.findByLabelText(/^Passwort$/);
    // the in-page Back button uses the same history: one more Back would leave the page, not loop
    await user.click(screen.getByRole("button", { name: "Zurück" }));
    expect(await screen.findByRole("button", { name: "Weiter" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "history-forward" }));
    await screen.findByLabelText(/^Passwort$/);
  });

  it("goes back with Escape", async () => {
    const user = await loginStep();
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: "Weiter" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^E-Mail/ })).toHaveValue("alex@beispiel.de");
  });
});

describe("identify: register", () => {
  async function registerStep(overview: unknown = NONE) {
    mockApi("register");
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/auth/registration" ? { restricted: false } : overview),
    );
    renderFlow("/signup");
    const user = await continueWith();
    await screen.findByLabelText(/^Name/);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Konto erstellen" })).toBeEnabled(),
    );
    return user;
  }

  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    pw = "sicheres-passwort",
    pw2 = pw,
  ) {
    await user.type(screen.getByLabelText(/^Name/), "Alex Beispiel");
    if (pw) await user.type(screen.getByLabelText(/^Passwort$/), pw);
    if (pw2) await user.type(screen.getByLabelText(/^Passwort wiederholen/), pw2);
    await user.click(screen.getByRole("button", { name: "Konto erstellen" }));
  }

  it("shows the signup form with a read-only address and focuses the name", async () => {
    await registerStep();
    expect(screen.getByRole("heading", { level: 1, name: "Konto erstellen" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("E-Mail", { selector: "#signup-email" })).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText(/^Passwort$/)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText(/^Passwort wiederholen/)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("E-Mail", { selector: "#signup-email" })).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText(/^Passwort$/)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByText("Mindestens 8 Zeichen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mit Passkey anmelden" })).toBeNull();
  });

  it("rejects a short password and mismatching passwords without calling the API", async () => {
    const user = await registerStep();
    apiPost.mockClear();
    await fill(user, "abc123");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Das Konto wurde noch nicht erstellt");
    expect(alert).toHaveTextContent("zu kurz");
    expect(alert).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("reports mismatching passwords", async () => {
    const user = await registerStep();
    apiPost.mockClear();
    await fill(user, "sicheres-passwort", "anderes-passwort");
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht gleich");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("registers, stores the restricted session and continues to the confirmation page", async () => {
    const user = await registerStep();
    apiPost.mockResolvedValue({
      access_token: "a",
      refresh_token: "r",
      user: { id: "u1" },
      emailVerificationRequired: true,
      verificationRequired: true,
      email: "alex@beispiel.de",
    });
    await fill(user);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/register", {
        name: "Alex Beispiel",
        email: "alex@beispiel.de",
        password: "sicheres-passwort",
        language: expect.any(String),
        acceptedDocuments: [],
      }),
    );
    expect(login).toHaveBeenCalledWith("a", "r", { id: "u1", emailVerificationRequired: true });
    expect(await screen.findByTestId("location")).toHaveTextContent("/verify-email");
  });

  it("sends the ids of the accepted consent documents and requires them", async () => {
    const BOTH = {
      imprint: null,
      privacy: { id: "doc-p", title: null, publishedAt: "2026-01-01T00:00:00Z" },
      terms: { id: "doc-t", title: null, publishedAt: "2026-01-01T00:00:00Z" },
    };
    const user = await registerStep(BOTH);
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Datenschutzerklärung");
    apiPost.mockClear();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({ acceptedDocuments: ["doc-p", "doc-t"] }),
      ),
    );
  });

  it("points an address that got a account meanwhile back to step 1", async () => {
    const user = await registerStep();
    apiPost.mockRejectedValue(Object.assign(new Error("x"), { status: 400, code: "email_taken" }));
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("schon ein Konto");
    await user.click(screen.getByRole("button", { name: "Zur Anmeldung" }));
    expect(await screen.findByRole("button", { name: "Weiter" })).toBeInTheDocument();
  });

  it("shows the rate limit of the registration", async () => {
    const user = await registerStep();
    apiPost.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Versuche");
  });
});

describe("identify: registration_restricted", () => {
  it("explains the invitation requirement without a signup form and offers Back", async () => {
    mockApi("registration_restricted");
    renderFlow();
    const user = await continueWith();
    expect(
      await screen.findByText("Die Registrierung ist nur mit einer Einladung möglich", {
        selector: "p",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/keine Einladung vor/)).toHaveTextContent("alex@beispiel.de");
    expect(screen.queryByLabelText(/^Passwort/)).toBeNull();
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    const back = screen.getByRole("button", { name: "Zurück" });
    expect(back).toHaveFocus();
    await user.click(back);
    expect(await screen.findByRole("button", { name: "Weiter" })).toBeInTheDocument();
  });
});

describe("invitation link", () => {
  const PREVIEW = {
    email: "eingeladen@beispiel.de",
    clubName: "Schützenverein",
    invitedByName: "Max",
    expiresAt: "2026-12-01T00:00:00Z",
  };

  it("previews the stashed token, shows the club and prefills the address", async () => {
    stashInvitationToken("tok123");
    mockApi("register", { "/api/invitations/preview": PREVIEW });
    renderFlow();
    expect(
      await screen.findByText(/Max hat dich zum Verein „Schützenverein“ eingeladen/),
    ).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith("/api/invitations/preview", { token: "tok123" });
    const email = screen.getByLabelText(/^E-Mail/);
    expect(email).toHaveValue("eingeladen@beispiel.de");
    // the visitor still presses Continue; identify decides
    expect(apiPost).not.toHaveBeenCalledWith("/api/auth/identify", expect.anything());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByLabelText(/^Name/)).toBeInTheDocument();
    expect(sessionStorage.getItem("cc.invitationToken")).toBe("tok123");
  });

  it("lets the visitor replace the prefilled address", async () => {
    stashInvitationToken("tok123");
    mockApi("login", { "/api/invitations/preview": PREVIEW });
    renderFlow();
    await screen.findByText(/Schützenverein/);
    const user = userEvent.setup();
    const email = screen.getByLabelText(/^E-Mail/);
    await user.clear(email);
    await user.type(email, "ich@beispiel.de");
    expect(email).toHaveValue("ich@beispiel.de");
  });

  it("shows a neutral hint for an unknown or expired token and keeps the flow usable", async () => {
    stashInvitationToken("dead");
    mockApi("login");
    apiPost.mockImplementation((path: string) =>
      path === "/api/invitations/preview"
        ? Promise.reject(new ApiError("x", 404, "invitation_not_found"))
        : Promise.resolve({ email: "a@b.de", status: "login" }),
    );
    renderFlow();
    expect(await screen.findByText("Einladung ungültig oder abgelaufen")).toBeInTheDocument();
    expect(screen.getByLabelText(/^E-Mail/)).toHaveValue("");
    await waitFor(() => expect(sessionStorage.getItem("cc.invitationToken")).toBeNull());
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^E-Mail/), "a@b.de");
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByLabelText(/^Passwort$/)).toBeInTheDocument();
  });

  it("makes no preview call without a token", () => {
    renderFlow();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe("feed proof", () => {
  it("sends the stashed proof with identify and shows a note", async () => {
    stashFeedProof({ feedId: "f1", secret: "s3cret" });
    renderFlow();
    expect(
      screen.getByText(/Nach der Anmeldung geht es mit dem Kalender weiter/),
    ).toBeInTheDocument();
    await continueWith();
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/identify", {
        email: "Alex@beispiel.de",
        feedProof: { feedId: "f1", secret: "s3cret" },
      }),
    );
  });

  it("sends no feedProof without a stash", async () => {
    renderFlow();
    await continueWith();
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/identify", { email: "Alex@beispiel.de" }),
    );
  });

  it("passes the proof to the SSO start route", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    stashFeedProof({ feedId: "f1", secret: "s3cret" });
    renderFlow();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Mit Google anmelden" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.searchParams.get("feed_id")).toBe("f1");
    expect(url.searchParams.get("secret")).toBe("s3cret");
    vi.unstubAllGlobals();
  });

  it("sends the proof with the registration (restricted registration)", async () => {
    stashFeedProof({ feedId: "f1" });
    mockApi("register");
    renderFlow("/signup");
    const user = await continueWith();
    await screen.findByLabelText(/^Name/);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Konto erstellen" })).toBeEnabled(),
    );
    await user.type(screen.getByLabelText(/^Name/), "Alex Beispiel");
    await user.type(screen.getByLabelText(/^Passwort$/), "sicheres-passwort");
    await user.type(screen.getByLabelText(/^Passwort wiederholen/), "sicheres-passwort");
    await user.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({ feedProof: { feedId: "f1" } }),
      ),
    );
  });
});
