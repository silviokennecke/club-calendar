import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupPage from "../SignupPage";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({ apiPost: (...a: unknown[]) => apiPost(...a) }));

function renderSignup() {
  return renderAt("/signup", "/signup", <SignupPage />);
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
  it("has labelled fields with autocomplete attributes", () => {
    renderSignup();
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
    renderSignup();
    await fill("abc123", "abc123");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Das Konto wurde noch nicht erstellt");
    expect(alert).toHaveTextContent("zu kurz");
    expect(screen.getByLabelText(/^Passwort \(Pflicht\)/)).toHaveAttribute("aria-invalid", "true");
    expect(alert.parentElement).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("rejects mismatching passwords", async () => {
    renderSignup();
    await fill("sicheres-passwort", "anderes-passwort");
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht gleich");
    expect(screen.getByLabelText(/^Passwort wiederholen/)).toHaveAttribute("aria-invalid", "true");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("reports missing required fields", async () => {
    renderSignup();
    await fill("", "", "");
    expect(await screen.findByRole("alert")).toHaveTextContent("Pflichtfelder");
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
  });

  it("points existing accounts to the login", async () => {
    // Recognised by the stable code, whatever the text says
    apiPost.mockRejectedValue(
      Object.assign(new Error("Diese Adresse ist vergeben"), { status: 400, code: "email_taken" }),
    );
    renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("schon ein Konto");
    expect(screen.getByRole("link", { name: "Zur Anmeldung" })).toHaveAttribute("href", "/login");
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
  });

  it("does not treat other 400 errors as an existing account", async () => {
    apiPost.mockRejectedValue(Object.assign(new Error("Email already in use"), { status: 400 }));
    renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("schon ein Konto");
  });

  it("registers and continues to the confirmation page", async () => {
    apiPost.mockResolvedValue({});
    renderSignup();
    await fill("sicheres-passwort", "sicheres-passwort");
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/register", {
        name: "Alex Beispiel",
        email: "alex@beispiel.de",
        password: "sicheres-passwort",
        language: expect.any(String),
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/auth/verify-email?email=alex%40beispiel.de",
    );
  });
});
