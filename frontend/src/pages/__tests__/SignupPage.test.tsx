import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SignupPage from "../SignupPage";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiErrorStatus: () => undefined,
}));

const NONE = { imprint: null, privacy: null, terms: null };
const BOTH = {
  imprint: null,
  privacy: { id: "doc-p", title: null, publishedAt: "2026-01-01T00:00:00Z" },
  terms: { id: "doc-t", title: null, publishedAt: "2026-01-01T00:00:00Z" },
};

async function renderSignup(overview: unknown = NONE, restricted = false) {
  apiGet.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/auth/registration" ? { restricted } : overview),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderAt(
    "/signup",
    "/signup",
    <QueryClientProvider client={qc}>
      <SignupPage />
    </QueryClientProvider>,
  );
  // submit is blocked until the list of documents is known
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Konto erstellen" })).toBeEnabled(),
  );
  return view;
}

async function fill(pw: string, pw2: string, email = "alex@beispiel.de") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Name/), "Alex Beispiel");
  if (email) await user.type(screen.getByLabelText(/^E-Mail/), email);
  if (pw) await user.type(screen.getByLabelText(/^Passwort \(Pflicht\)/), pw);
  if (pw2) await user.type(screen.getByLabelText(/^Passwort wiederholen/), pw2);
  await user.click(screen.getByRole("button", { name: "Konto erstellen" }));
}

beforeEach(() => vi.clearAllMocks());

describe("SignupPage", () => {
  it("has labelled fields with autocomplete attributes", async () => {
    await renderSignup();
    expect(screen.getByRole("heading", { level: 1, name: "Konto erstellen" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(/^Passwort \(Pflicht\)/)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByText("Mindestens 8 Zeichen")).toBeInTheDocument();
  });

  it("rejects a short password without calling the API", async () => {
    await renderSignup();
    await fill("abc123", "abc123");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Das Konto wurde noch nicht erstellt");
    expect(alert).toHaveTextContent("zu kurz");
    const password = screen.getByLabelText(/^Passwort \(Pflicht\)/);
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveFocus();
    expect(screen.getByRole("link", { name: /zu kurz/ })).toHaveAttribute(
      "href",
      "#signup-password",
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("rejects mismatching passwords", async () => {
    await renderSignup();
    await fill("sicheres-passwort", "anderes-passwort");
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht gleich");
    expect(screen.getByLabelText(/^Passwort wiederholen/)).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("reports missing required fields", async () => {
    await renderSignup();
    await fill("", "", "");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte gib deine E-Mail-Adresse ein.",
    );
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^E-Mail/)).toHaveFocus();
  });

  it("points existing accounts to the login", async () => {
    // Recognised by the stable code, whatever the text says
    apiPost.mockRejectedValue(
      Object.assign(new Error("Diese Adresse ist vergeben"), { status: 400, code: "email_taken" }),
    );
    await renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("schon ein Konto");
    expect(screen.getByRole("link", { name: "Zur Anmeldung" })).toHaveAttribute("href", "/login");
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the invitation-only hint only when registration is restricted", async () => {
    const { unmount } = await renderSignup(NONE, true);
    expect(await screen.findByText(/nur mit einer Einladung möglich/)).toBeInTheDocument();
    unmount();
    await renderSignup(NONE, false);
    expect(screen.queryByText(/nur mit einer Einladung möglich/)).not.toBeInTheDocument();
  });

  it("shows a field error on the e-mail when registration_restricted comes back", async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("x"), { status: 403, code: "registration_restricted" }),
    );
    await renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    await waitFor(() =>
      expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getAllByText(/liegt keine Einladung vor/).length).toBeGreaterThan(0);
  });

  it("does not treat other 400 errors as an existing account", async () => {
    apiPost.mockRejectedValue(Object.assign(new Error("Email already in use"), { status: 400 }));
    await renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("schon ein Konto");
  });

  it("registers and continues to the confirmation page", async () => {
    apiPost.mockResolvedValue({});
    await renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/register", {
        name: "Alex Beispiel",
        email: "alex@beispiel.de",
        password: "sicheres-passwort",
        language: expect.any(String),
        acceptedDocuments: [],
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email?email=alex%40beispiel.de",
    );
  });

  describe("consent documents", () => {
    it("shows no checkbox and sends an empty list when nothing is provided", async () => {
      apiPost.mockResolvedValue({});
      await renderSignup(NONE);
      expect(screen.queryByRole("checkbox")).toBeNull();
      await fill("sicheres-passwort", "sicheres-passwort");
      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith(
          "/api/auth/register",
          expect.objectContaining({ acceptedDocuments: [] }),
        ),
      );
    });

    it("requires every provided document and links it as a modal", async () => {
      await renderSignup({ ...BOTH, terms: null });
      expect(screen.getAllByRole("checkbox")).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute(
        "href",
        "/privacy",
      );
      await fill("sicheres-passwort", "sicheres-passwort");
      expect(await screen.findByRole("alert")).toHaveTextContent("Datenschutzerklärung");
      expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("checkbox")).toHaveFocus();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("opens a linked document in a new tab instead of the modal", async () => {
      await renderSignup({
        ...BOTH,
        terms: null,
        privacy: {
          id: "doc-p",
          title: null,
          url: "https://example.org/datenschutz",
          publishedAt: "2026-01-01T00:00:00Z",
        },
      });
      const link = await screen.findByRole("link", { name: "Datenschutzerklärung" });
      expect(link).toHaveAttribute("href", "https://example.org/datenschutz");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("sends the ids of the accepted documents", async () => {
      apiPost.mockResolvedValue({});
      await renderSignup(BOTH);
      const user = userEvent.setup();
      for (const box of screen.getAllByRole("checkbox")) await user.click(box);
      await fill("sicheres-passwort", "sicheres-passwort");
      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith(
          "/api/auth/register",
          expect.objectContaining({ acceptedDocuments: ["doc-p", "doc-t"] }),
        ),
      );
    });

    it("unchecks, reloads the list and reports an outdated document", async () => {
      apiPost.mockRejectedValue(
        Object.assign(new Error("x"), { status: 422, code: "consent_outdated" }),
      );
      await renderSignup(BOTH);
      const user = userEvent.setup();
      for (const box of screen.getAllByRole("checkbox")) await user.click(box);
      apiGet.mockClear();
      apiGet.mockResolvedValue({
        ...BOTH,
        privacy: { id: "doc-p2", title: null, publishedAt: "2026-02-01T00:00:00Z" },
      });
      await fill("sicheres-passwort", "sicheres-passwort");
      expect(await screen.findByText(/aktualisiert/)).toBeInTheDocument();
      expect(apiGet).toHaveBeenCalledWith("/api/legal");
      for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
      expect(screen.getAllByText(/Bitte akzeptiere/).length).toBeGreaterThan(0);
    });
  });
});
