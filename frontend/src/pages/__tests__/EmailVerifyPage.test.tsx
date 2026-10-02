import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmailVerifyPage from "../EmailVerifyPage";
import { renderAt } from "./authTestUtils";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

function renderVerify(search = "") {
  return renderAt(`/auth/verify-email${search}`, "/auth/verify-email", <EmailVerifyPage />);
}

beforeEach(() => vi.clearAllMocks());

describe("EmailVerifyPage", () => {
  it("shows success with a link to the login", () => {
    renderVerify("?status=success");
    expect(
      screen.getByRole("heading", { level: 1, name: "E-Mail-Adresse bestätigt" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Anmeldung" })).toHaveAttribute("href", "/login");
  });

  it.each([
    ["expired", "Der Link ist abgelaufen"],
    ["already_used", "Der Link wurde schon benutzt"],
    ["invalid", "Der Link ist ungültig"],
    ["whatever", "Der Link ist ungültig"],
  ])("maps reason %s to its state", (reason, title) => {
    renderVerify(`?status=error&reason=${reason}`);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("offers a new mail for expired links", () => {
    renderVerify("?status=error&reason=expired");
    expect(screen.getByRole("link", { name: "Neue Bestätigungsmail anfordern" })).toHaveAttribute(
      "href",
      "/auth/verify-email",
    );
  });

  it("asks to confirm the address and resends the mail", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ ok: true });
    renderVerify("?email=alex%40beispiel.de");
    expect(
      screen.getByRole("heading", { level: 1, name: "Bitte bestätige deine E-Mail-Adresse" }),
    ).toBeInTheDocument();
    expect(screen.getByText("alex@beispiel.de").tagName).toBe("STRONG");
    await user.click(screen.getByRole("button", { name: "Bestätigungsmail erneut senden" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email: "alex@beispiel.de" }),
    });
    expect(await screen.findByText("Bestätigungsmail gesendet")).toBeInTheDocument();
  });

  it("asks for the address when none is known", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ ok: true });
    renderVerify();
    await user.click(screen.getByRole("button", { name: "Bestätigungsmail erneut senden" }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText(/^E-Mail/), "neu@beispiel.de");
    await user.click(screen.getByRole("button", { name: "Bestätigungsmail erneut senden" }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
