import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import ForgotPasswordPage from "../ForgotPasswordPage";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue(undefined);
});

async function submit(email: string) {
  const user = userEvent.setup();
  renderAt("/forgot-password", "/forgot-password", <ForgotPasswordPage />);
  if (email) await user.type(screen.getByLabelText(/^E-Mail/), email);
  await user.click(screen.getByRole("button", { name: "Link zum Zurücksetzen senden" }));
  return user;
}

describe("ForgotPasswordPage", () => {
  it("shows the form without the old 'coming soon' notice", () => {
    renderAt("/forgot-password", "/forgot-password", <ForgotPasswordPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Passwort vergessen?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bald verfügbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link zum Zurücksetzen senden" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Zurück zur Anmeldung" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("asks for the address before sending", async () => {
    await submit("");
    expect(screen.getAllByText("Bitte gib deine E-Mail-Adresse ein.").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("noch nicht angefordert");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("flags a malformed address on blur and clears the error while editing", async () => {
    const user = userEvent.setup();
    renderAt("/forgot-password", "/forgot-password", <ForgotPasswordPage />);
    const input = screen.getByLabelText(/^E-Mail/);
    await user.type(input, "abc");
    expect(input).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.type(input, "@beispiel.de");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows 'Prüfe dein Postfach' with the entered address and focuses it", async () => {
    const user = await submit(" alex@beispiel.de ");
    const heading = await screen.findByRole("heading", { level: 1, name: "Prüfe dein Postfach" });
    expect(apiPost).toHaveBeenCalledWith("/api/auth/forgot-password", {
      email: "alex@beispiel.de",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wenn zu alex@beispiel.de ein Konto gehört",
    );
    await waitFor(() => expect(heading).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Andere E-Mail-Adresse eingeben" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Passwort vergessen?" }),
    ).toBeInTheDocument();
  });

  it("shows the same success for rate limits (no account oracle)", async () => {
    apiPost.mockRejectedValue(new ApiError("Too Many Requests", 429));
    await submit("alex@beispiel.de");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Prüfe dein Postfach" }),
    ).toBeInTheDocument();
  });

  it("explains network errors and invalid addresses", async () => {
    apiPost.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = await submit("alex@beispiel.de");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Link konnte nicht angefordert werden",
    );
    apiPost.mockRejectedValueOnce(new ApiError("x", 422, "validation_failed"));
    await user.click(screen.getByRole("button", { name: "Link zum Zurücksetzen senden" }));
    expect(
      (await screen.findAllByText(/Bitte gib eine gültige E-Mail-Adresse ein/))[0],
    ).toBeInTheDocument();
  });
});
